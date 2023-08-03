const AWS = require('aws-sdk');
const { ProxyAgent } = require('proxy-agent');

const apigatewayApiVersion = '2015-07-09';

class ApigatewayLogRetentionPlugin {
    constructor(serverless, options) {
        this.serverless = serverless;
        this.options = options;
        this.hooks = {
            'after:deploy:deploy': this.setApigatewayLogRetention.bind(this, serverless),
        };
    }

    updateRetentionPolicy(logGroupName, retentionInDays) {
        const cloudWatchLogs = new AWS.CloudWatchLogs({ region: this.serverless.getProvider('aws').getRegion() });
        if (`${retentionInDays}`.toLowerCase() === 'never expire') {
            return cloudWatchLogs.deleteRetentionPolicy({ logGroupName }).promise();
        }
        return cloudWatchLogs.putRetentionPolicy({ logGroupName, retentionInDays }).promise();
    }

    async getRestApiId() {
        const apiGateway = new AWS.APIGateway({
            apiVersion: apigatewayApiVersion,
            region: this.serverless.getProvider('aws').getRegion(),
        });

        const apis = [];
        let marker;
        do {
            const { items, position } = await apiGateway.getRestApis({ position: marker, limit: 500 }).promise();
            apis.push(...(items || []));
            marker = position;
        } while (marker);
        const customApiName = this.serverless.service.provider.apiName;
        const apiName = customApiName || (this.serverless.service.provider.apiGateway?.shouldStartNameWithService
            ? `${this.serverless.service.getServiceName()}-${this.options.stage}`
            : `${this.options.stage}-${this.serverless.service.getServiceName()}`);
        const match = apis.find((api) => api.name === apiName);
        if (!match) {
            throw new Error(`Api ${apiName} does not exist.`);
        }
        return match.id;
    }

    async getAccessLogGroupName(restApiId) {
        const apiGateway = new AWS.APIGateway({
            apiVersion: apigatewayApiVersion,
            region: this.serverless.getProvider('aws').getRegion(),
        });
        const params = {
            restApiId,
            stageName: this.options.stage,
        };
        const stageConfig = await apiGateway.getStage(params).promise();

        if (stageConfig.accessLogSettings && stageConfig.accessLogSettings.destinationArn) {
            return stageConfig.accessLogSettings.destinationArn.split('log-group:')[1];
        }
        throw new Error(
            `Access log destination ARN not set! Please check access logging is enabled and destination ARN is configured in ApiGateway > stage > Logs/Tracing.`
        );
    }

    useAwsProfileIfprovided(awsSDK) {
        const profile = this.serverless.service.provider?.profile;
        if (profile) {
            AWS.config.credentials = new awsSDK.SharedIniFileCredentials({ profile });
        }
    }

    useProxyIfConfigured() {
        const proxy =
            process.env.HTTP_PROXY ||
            process.env.HTTPS_PROXY ||
            process.env.FTP_PROXY ||
            process.env.WSS_PROXY ||
            process.env.WS_PROXY;

        if (proxy) {
            AWS.config.update({
                httpOptions: { agent: new ProxyAgent() }
            });
        }
    }

    async setApigatewayLogRetention() {
        const {
            service: {
                custom: {
                    apigatewayLogRetention: {
                        accessLogging = { enabled: false },
                        executionLogging = { enabled: false },
                    } = {},
                } = {},
            } = {},
        } = this.serverless;
        if (!accessLogging.enabled && !executionLogging.enabled) {
            return;
        }

        this.useAwsProfileIfprovided(AWS);
        this.useProxyIfConfigured();

        let restApiId;
        try {
            restApiId = await this.getRestApiId();
        } catch (e) {
            const errorMessage = `serverless-apigateway-log-retention - ERROR: Failed to retrieve rest api id. ${e.message}`;
            this.serverless.cli.log(errorMessage);
            throw new Error(errorMessage);
        }

        if (accessLogging.enabled) {
            try {
                const accessLogGroupName = await this.getAccessLogGroupName(restApiId);
                await this.updateRetentionPolicy(accessLogGroupName, accessLogging.days);
                this.serverless.cli.log(
                    `serverless-apigateway-log-retention - Successfully set ApiGateway access log (${accessLogGroupName}) retention to ${accessLogging.days} days.`
                );
            } catch (e) {
                const errorMessage = `serverless-apigateway-log-retention - ERROR: Failed to set ApiGateway access log retention. ${e.message}`;
                this.serverless.cli.log(errorMessage);
                throw new Error(errorMessage);
            }
        }

        if (executionLogging.enabled) {
            try {
                const executionLogGroupName = `API-Gateway-Execution-Logs_${restApiId}/${this.options.stage}`;
                await this.updateRetentionPolicy(executionLogGroupName, executionLogging.days);
                this.serverless.cli.log(
                    `serverless-apigateway-log-retention - Successfully set ApiGateway execution log (${executionLogGroupName}) retention to ${executionLogging.days} days.`
                );
            } catch (e) {
                const errorMessage = `serverless-apigateway-log-retention - ERROR: Failed to set ApiGateway execution log retention. ${e.message}`;
                this.serverless.cli.log(errorMessage);
                throw new Error(errorMessage);
            }
        }
    }
}

module.exports = ApigatewayLogRetentionPlugin;
