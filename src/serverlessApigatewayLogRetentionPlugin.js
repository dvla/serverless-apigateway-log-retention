const { CloudWatchLogsClient, PutRetentionPolicyCommand, DeleteRetentionPolicyCommand } = require("@aws-sdk/client-cloudwatch-logs");
const { APIGatewayClient, GetStageCommand, GetRestApisCommand } = require("@aws-sdk/client-api-gateway");
const { fromIni } = require('@aws-sdk/credential-provider-ini');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const { ProxyAgent } = require('proxy-agent');

class ApigatewayLogRetentionPlugin {
    constructor(serverless, options) {
        this.serverless = serverless;
        this.options = options;
        this.hooks = {
            'after:deploy:deploy': this.setApigatewayLogRetention.bind(this, serverless),
        };
    }

    getRequestHandlerWithProxy(){
        const proxyAgent = new ProxyAgent();
        return new NodeHttpHandler({ httpAgent: proxyAgent, httpsAgent: proxyAgent })
    }

    updateRetentionPolicy(logGroupName, retentionInDays, cloudWatchLogs) {
        if (`${retentionInDays}`.toLowerCase() === 'never expire') {
            return cloudWatchLogs.send(new DeleteRetentionPolicyCommand({ logGroupName }))
        }
        return cloudWatchLogs.send(new PutRetentionPolicyCommand({ logGroupName, retentionInDays }))
    }

    async getRestApiId(apiGateway) {
        const apis = [];
        let marker;
        do {
            const { items, position } = await apiGateway.send(new GetRestApisCommand({ position: marker, limit: 500 }));
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

    async getAccessLogGroupName(restApiId, apiGateway) {
        const params = {
            restApiId,
            stageName: this.options.stage,
        };
        const stageConfig = await apiGateway.send(new GetStageCommand(params));

        if (stageConfig.accessLogSettings && stageConfig.accessLogSettings.destinationArn) {
            return stageConfig.accessLogSettings.destinationArn.split('log-group:')[1];
        }
        throw new Error(
            `Access log destination ARN not set! Please check access logging is enabled and destination ARN is configured in ApiGateway > stage > Logs/Tracing.`
        );
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
                provider: {
                    profile
                } = {}
            } = {},
        } = this.serverless;

        if (!accessLogging.enabled && !executionLogging.enabled) {
            return;
        }

        const proxy = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.FTP_PROXY || process.env.WSS_PROXY || process.env.WS_PROXY;
        const awsClientConfig = {
            region: this.serverless.getProvider('aws').getRegion(),
            ...(profile && { credentials: fromIni({ profile }) }),
            ...(proxy && { requestHandler: this.getRequestHandlerWithProxy() })
        }

        const cloudWatchLogs = new CloudWatchLogsClient(awsClientConfig);
        const apiGateway = new APIGatewayClient(awsClientConfig);

        let restApiId;
        try {
            restApiId = await this.getRestApiId(apiGateway);
        } catch (e) {
            const errorMessage = `serverless-apigateway-log-retention - ERROR: Failed to retrieve rest api id. ${e.message}`;
            this.serverless.cli.log(errorMessage);
            throw new Error(errorMessage);
        }

        if (accessLogging.enabled) {
            try {
                const accessLogGroupName = await this.getAccessLogGroupName(restApiId, apiGateway);
                await this.updateRetentionPolicy(accessLogGroupName, accessLogging.days, cloudWatchLogs);
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
                await this.updateRetentionPolicy(executionLogGroupName, executionLogging.days, cloudWatchLogs);
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
