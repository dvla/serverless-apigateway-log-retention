/* eslint-disable max-len */
const { mockClient } = require('aws-sdk-client-mock');
require('aws-sdk-client-mock-jest');
const { CloudWatchLogsClient, PutRetentionPolicyCommand, DeleteRetentionPolicyCommand } = require("@aws-sdk/client-cloudwatch-logs");
const { APIGatewayClient, GetStageCommand, GetRestApisCommand } = require("@aws-sdk/client-api-gateway");
const { ProxyAgent } = require('proxy-agent');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const { fromIni } = require('@aws-sdk/credential-provider-ini');

const mockCloudWatchLogsClient = mockClient(CloudWatchLogsClient);
const mockAPIGatewayClient = mockClient(APIGatewayClient);

jest.mock('proxy-agent');
jest.mock('@smithy/node-http-handler');
jest.mock('@aws-sdk/credential-provider-ini');

const Plugin = require('../serverlessApigatewayLogRetentionPlugin');

const OLD_ENV = process.env;

let serverless;
let options;

beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    serverless = {
        cli: { log: jest.fn() },
        getProvider: () => ({
            getRegion: () => 'eu-west-2',
        }),
        service: {
            getServiceName: () => 'serverless-log-retention-demo',
            custom: {},
            provider: {}
        },
    };
    options = {
        stage: 'dev',
    };
});

afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockCloudWatchLogsClient.reset();
    mockAPIGatewayClient.reset();
});

afterAll(() => {
    process.env = OLD_ENV;
});

describe('setLogRetention', () => {
    test('sets log retention policy on log group correctly when days is set to an integer', async () => {
        expect.assertions(3);
        mockCloudWatchLogsClient.on(PutRetentionPolicyCommand).resolves({});
        
        const expectedPutRetentionPolicyCommandInvokeParams = {
            logGroupName: 'API-Gateway-Execution-Logs_12abcdefgh/dev',
            retentionInDays: 7,
        };

        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        await apigatewayLogRetentionPlugin.updateRetentionPolicy('API-Gateway-Execution-Logs_12abcdefgh/dev', 7, mockCloudWatchLogsClient);

        expect(mockCloudWatchLogsClient).toHaveReceivedCommandTimes(PutRetentionPolicyCommand, 1);
        expect(mockCloudWatchLogsClient).toHaveReceivedCommandWith(PutRetentionPolicyCommand, expectedPutRetentionPolicyCommandInvokeParams);
    });

    test("deletes log retention policy on log group correctly when days is set to 'never expire'", async () => {
        expect.assertions(4);
        mockCloudWatchLogsClient.on(DeleteRetentionPolicyCommand).resolves({});

        const expectedDeleteRetentionPolicyCommandInvokeParams = {
            logGroupName: 'API-Gateway-Execution-Logs_12abcdefgh/dev',
        };

        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        await apigatewayLogRetentionPlugin.updateRetentionPolicy(
            'API-Gateway-Execution-Logs_12abcdefgh/dev',
            'Never ExPire',
            mockCloudWatchLogsClient
        );

        expect(mockCloudWatchLogsClient).toHaveReceivedCommandTimes(PutRetentionPolicyCommand, 0);
        expect(mockCloudWatchLogsClient).toHaveReceivedCommandTimes(DeleteRetentionPolicyCommand, 1);
        expect(mockCloudWatchLogsClient).toHaveReceivedCommandWith(DeleteRetentionPolicyCommand, expectedDeleteRetentionPolicyCommandInvokeParams);
    });

    test('throws error if putRetentionPolicy call erred', async () => {
        expect.assertions(2);
        const mockAwsError = new Error('some aws error');
        mockCloudWatchLogsClient.on(PutRetentionPolicyCommand).rejects(mockAwsError);

        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);

        await expect(
            apigatewayLogRetentionPlugin.updateRetentionPolicy('API-Gateway-Execution-Logs_12abcdefgh/dev', '7', mockCloudWatchLogsClient)
        ).rejects.toThrow(mockAwsError);
        expect(mockCloudWatchLogsClient).toHaveReceivedCommandTimes(PutRetentionPolicyCommand, 1);
    });

    test('throws error if deleteRetentionPolicy call erred', async () => {
        expect.assertions(2);
        const mockAwsError = new Error('some aws error');
        mockCloudWatchLogsClient.on(DeleteRetentionPolicyCommand).rejects(mockAwsError);

        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);

        await expect(
            apigatewayLogRetentionPlugin.updateRetentionPolicy(
                'API-Gateway-Execution-Logs_12abcdefgh/dev',
                'NEVER expire',
                mockCloudWatchLogsClient
            )
        ).rejects.toThrow(mockAwsError);
        expect(mockCloudWatchLogsClient).toHaveReceivedCommandTimes(DeleteRetentionPolicyCommand, 1);
    });
});

describe('getRestApiId', () => {
    test('returns API ID if there exists an API name matching the stack name', async () => {
        expect.assertions(4);
        mockAPIGatewayClient.on(GetRestApisCommand).resolves({
            items: [
                {
                    id: '1',
                    name: 'dev-serverless-log-retention-demo',
                },
                {
                    id: '2',
                    name: 'test1-serverless-log-retention-demo',
                },
            ],
        });

        const expectedGetRestApisCommandInvokeParams = {
            limit: 500,
        };

        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        const returnedApiId = await apigatewayLogRetentionPlugin.getRestApiId(mockAPIGatewayClient);

        expect(mockAPIGatewayClient).toHaveReceivedCommandTimes(GetRestApisCommand, 1);
        expect(mockAPIGatewayClient).toHaveReceivedCommandWith(GetRestApisCommand, expectedGetRestApisCommandInvokeParams);
        expect(returnedApiId).toEqual('1');
    });

    test('finds matching API from over 500 RestApis', async () => {
        expect.assertions(1);
        mockAPIGatewayClient.on(GetRestApisCommand)
            .resolvesOnce({
                items: Array(500).fill({
                    id: '2',
                    name: 'test1-serverless-log-retention-demo',
                }),
                position: 'next'
            })
            .resolves({
                items: [
                    {
                        id: '3',
                        name: 'test1-serverless-log-retention-demo',
                    },
                    {
                        id: '1',
                        name: 'dev-serverless-log-retention-demo',
                    }
                ],
                position: undefined
            });

        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        const returnedApiId = await apigatewayLogRetentionPlugin.getRestApiId(mockAPIGatewayClient);

        expect(returnedApiId).toEqual('1');
    })

    test('support shouldStartNameWithService in serverless setting', async () => {
        expect.assertions(4);
        serverless.service.provider.apiGateway = { shouldStartNameWithService: true };
        mockAPIGatewayClient.on(GetRestApisCommand).resolves({
            items: [
                {
                    id: '1',
                    name: 'serverless-log-retention-demo-dev',
                },
                {
                    id: '2',
                    name: 'serverless-log-retention-demo-test1',
                },
            ],
        });

        const expectedGetRestApisCommandInvokeParams = {
            limit: 500,
        };

        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        const returnedApiId = await apigatewayLogRetentionPlugin.getRestApiId(mockAPIGatewayClient);

        expect(mockAPIGatewayClient).toHaveReceivedCommandTimes(GetRestApisCommand, 1);
        expect(mockAPIGatewayClient).toHaveReceivedCommandWith(GetRestApisCommand, expectedGetRestApisCommandInvokeParams);
        expect(returnedApiId).toEqual('1');
    });

    test('support predefined apiName in serverless setting', async () => {
        expect.assertions(4);
        serverless.service.provider.apiName = 'v1x01-test-api-dev';
        mockAPIGatewayClient.on(GetRestApisCommand).resolves({
            items: [
                {
                    id: '1',
                    name: 'v1x01-test-api-dev',
                },
                {
                    id: '2',
                    name: 'serverless-log-retention-demo-test1',
                },
            ],
        });

        const expectedGetRestApisCommandInvokeParams = {
            limit: 500,
        };

        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        const returnedApiId = await apigatewayLogRetentionPlugin.getRestApiId(mockAPIGatewayClient);

        expect(mockAPIGatewayClient).toHaveReceivedCommandTimes(GetRestApisCommand, 1);
        expect(mockAPIGatewayClient).toHaveReceivedCommandWith(GetRestApisCommand, expectedGetRestApisCommandInvokeParams);
        expect(returnedApiId).toEqual('1');
    });

    test('throws error if there is no API name matching the deployed stack name', async () => {
        expect.assertions(2);
        mockAPIGatewayClient.on(GetRestApisCommand).resolves({
            items: [
                {
                    id: '1',
                    name: 'test1-serverless-log-retention-demo',
                },
                {
                    id: '2',
                    name: 'test2-serverless-log-retention-demo',
                },
            ],
        });

        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        const expectedError = new Error('Api dev-serverless-log-retention-demo does not exist.');

        await expect(apigatewayLogRetentionPlugin.getRestApiId(mockAPIGatewayClient)).rejects.toThrow(expectedError);
        expect(mockAPIGatewayClient).toHaveReceivedCommandTimes(GetRestApisCommand, 1);
    });

    test('throws error if getRestApis call erred', async () => {
        expect.assertions(2);
        const mockAwsError = new Error('some aws error');
        mockAPIGatewayClient.on(GetRestApisCommand).rejects(mockAwsError);
        
        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);

        await expect(apigatewayLogRetentionPlugin.getRestApiId(mockAPIGatewayClient)).rejects.toThrow(mockAwsError);
        expect(mockAPIGatewayClient).toHaveReceivedCommandTimes(GetRestApisCommand, 1);
    });
});

describe('getAccessLogGroupName', () => {
    test('returns access log group name given rest API ID and stage', async () => {
        expect.assertions(4);
        mockAPIGatewayClient.on(GetStageCommand).resolves({
            id: '1',
            accessLogSettings: {
                destinationArn:
                    'arn:aws:logs:eu-west-2:123456789123:log-group:/aws/api-gateway/serverless-log-retention-demo-dev',
            },
        });

        const expectedGetStageCommandInvokeParams = {
            restApiId: '1',
            stageName: options.stage,
        };

        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        const returnedAccessLogGroupName = await apigatewayLogRetentionPlugin.getAccessLogGroupName('1', mockAPIGatewayClient);

        expect(mockAPIGatewayClient).toHaveReceivedCommandTimes(GetStageCommand, 1);
        expect(mockAPIGatewayClient).toHaveReceivedCommandWith(GetStageCommand, expectedGetStageCommandInvokeParams);
        expect(returnedAccessLogGroupName).toEqual('/aws/api-gateway/serverless-log-retention-demo-dev');
    });

    test('throws error if access log ARN not set', async () => {
        expect.assertions(1);
        mockAPIGatewayClient.on(GetStageCommand).resolves({
            id: '1',
            accessLogSettings: {
                destinationArn: '',
            },
        });

        const expectedError = new Error(
            'Access log destination ARN not set! Please check access logging is enabled and destination ARN is configured in ApiGateway > stage > Logs/Tracing.'
        );
        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);

        await expect(apigatewayLogRetentionPlugin.getAccessLogGroupName('1', mockAPIGatewayClient)).rejects.toThrow(expectedError);
    });

    test('throws error if access logs not turned on', async () => {
        expect.assertions(1);
        mockAPIGatewayClient.on(GetStageCommand).resolves({
            id: '1',
        });

        const expectedError = new Error(
            'Access log destination ARN not set! Please check access logging is enabled and destination ARN is configured in ApiGateway > stage > Logs/Tracing.'
        );
        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);

        await expect(apigatewayLogRetentionPlugin.getAccessLogGroupName('1', mockAPIGatewayClient)).rejects.toThrow(expectedError);
    });

    test('throws error if getStage call erred', async () => {
        expect.assertions(1);
        const mockAwsError = new Error('some aws error');

        mockAPIGatewayClient.on(GetStageCommand).rejects(mockAwsError);
        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);

        await expect(apigatewayLogRetentionPlugin.getAccessLogGroupName('1', mockAPIGatewayClient)).rejects.toThrow(mockAwsError);
    });
});

describe('setApigatewayLogRetention', () => {
    test('returns early if access logging and execution logging is disabled', async () => {
        expect.assertions(1);
        serverless.service.custom = {
            apigatewayLogRetention: {
                accessLogging: { enabled: false },
                executionLogging: { enabled: false },
            },
        };
        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        apigatewayLogRetentionPlugin.getRestApiId = jest.fn();

        await apigatewayLogRetentionPlugin.setApigatewayLogRetention();

        expect(apigatewayLogRetentionPlugin.getRestApiId).toHaveBeenCalledTimes(0);
    });

    test('returns early if plugin config is missing', async () => {
        expect.assertions(1);
        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        apigatewayLogRetentionPlugin.getRestApiId = jest.fn();

        await apigatewayLogRetentionPlugin.setApigatewayLogRetention();

        expect(apigatewayLogRetentionPlugin.getRestApiId).toHaveBeenCalledTimes(0);
    });

    test("errors correctly if rest api id couldn't be fetched", async () => {
        expect.assertions(3);
        serverless.service.custom = {
            apigatewayLogRetention: {
                accessLogging: { enabled: true, days: 7 },
                executionLogging: { enabled: false },
            },
        };
        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        apigatewayLogRetentionPlugin.getRestApiId = jest.fn().mockImplementation(() => {
            throw new Error('some aws error');
        });

        await expect(apigatewayLogRetentionPlugin.setApigatewayLogRetention()).rejects.toThrow(
            new Error('serverless-apigateway-log-retention - ERROR: Failed to retrieve rest api id. some aws error')
        );
        expect(apigatewayLogRetentionPlugin.getRestApiId).toHaveBeenCalledTimes(1);
        expect(serverless.cli.log).toHaveBeenCalledWith(
            'serverless-apigateway-log-retention - ERROR: Failed to retrieve rest api id. some aws error'
        );
    });

    test("errors correctly if access log group name couldn't be fetched while trying to update access log group retention", async () => {
        expect.assertions(4);
        serverless.service.custom = {
            apigatewayLogRetention: {
                accessLogging: { enabled: true, days: 7 },
                executionLogging: { enabled: false },
            },
        };
        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        apigatewayLogRetentionPlugin.getRestApiId = jest.fn().mockImplementation(() => '1234');
        apigatewayLogRetentionPlugin.getAccessLogGroupName = jest.fn().mockImplementation(() => {
            throw new Error('some aws error');
        });

        await expect(apigatewayLogRetentionPlugin.setApigatewayLogRetention()).rejects.toThrow(
            new Error(
                'serverless-apigateway-log-retention - ERROR: Failed to set ApiGateway access log retention. some aws error'
            )
        );
        expect(apigatewayLogRetentionPlugin.getRestApiId).toHaveBeenCalledTimes(1);
        expect(apigatewayLogRetentionPlugin.getAccessLogGroupName).toHaveBeenCalledTimes(1);
        expect(serverless.cli.log).toHaveBeenCalledWith(
            'serverless-apigateway-log-retention - ERROR: Failed to set ApiGateway access log retention. some aws error'
        );
    });

    test('errors correctly if an error occurred while trying to update access log group retention', async () => {
        expect.assertions(5);
        serverless.service.custom = {
            apigatewayLogRetention: {
                accessLogging: { enabled: true, days: 7 },
                executionLogging: { enabled: false },
            },
        };
        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        apigatewayLogRetentionPlugin.getRestApiId = jest.fn().mockImplementation(() => '1234');
        apigatewayLogRetentionPlugin.getAccessLogGroupName = jest
            .fn()
            .mockImplementation(() => '/aws/api-gateway/serverless-log-retention-demo-dev');
        apigatewayLogRetentionPlugin.updateRetentionPolicy = jest.fn().mockImplementation(() => {
            throw new Error('invalid parameter days');
        });

        await expect(apigatewayLogRetentionPlugin.setApigatewayLogRetention()).rejects.toThrow(
            new Error(
                'serverless-apigateway-log-retention - ERROR: Failed to set ApiGateway access log retention. invalid parameter days'
            )
        );
        expect(apigatewayLogRetentionPlugin.getRestApiId).toHaveBeenCalledTimes(1);
        expect(apigatewayLogRetentionPlugin.getAccessLogGroupName).toHaveBeenCalledTimes(1);
        expect(apigatewayLogRetentionPlugin.updateRetentionPolicy).toHaveBeenCalledTimes(1);
        expect(serverless.cli.log).toHaveBeenCalledWith(
            'serverless-apigateway-log-retention - ERROR: Failed to set ApiGateway access log retention. invalid parameter days'
        );
    });

    test("errors correctly if execution log group retention couldn't be set", async () => {
        expect.assertions(3);
        serverless.service.custom = {
            apigatewayLogRetention: {
                accessLogging: { enabled: false },
                executionLogging: { enabled: true, days: 7 },
            },
        };
        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        apigatewayLogRetentionPlugin.getRestApiId = jest.fn().mockImplementation(() => '1234');
        apigatewayLogRetentionPlugin.updateRetentionPolicy = jest.fn().mockImplementation(() => {
            throw new Error('invalid parameter days');
        });

        await expect(apigatewayLogRetentionPlugin.setApigatewayLogRetention()).rejects.toThrow(
            new Error(
                'serverless-apigateway-log-retention - ERROR: Failed to set ApiGateway execution log retention. invalid parameter days'
            )
        );
        expect(apigatewayLogRetentionPlugin.getRestApiId).toHaveBeenCalledTimes(1);
        expect(serverless.cli.log).toHaveBeenCalledWith(
            'serverless-apigateway-log-retention - ERROR: Failed to set ApiGateway execution log retention. invalid parameter days'
        );
    });

    test('sets access and execution log retention correctly', async () => {
        expect.assertions(9);
        serverless.service.custom = {
            apigatewayLogRetention: {
                accessLogging: { enabled: true, days: 7 },
                executionLogging: { enabled: true, days: 14 },
            },
        };
        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        apigatewayLogRetentionPlugin.getRestApiId = jest.fn().mockImplementation(() => '1234');
        apigatewayLogRetentionPlugin.getAccessLogGroupName = jest
            .fn()
            .mockImplementation(() => '/aws/api-gateway/serverless-log-retention-demo-dev');
        apigatewayLogRetentionPlugin.updateRetentionPolicy = jest.fn();

        await apigatewayLogRetentionPlugin.setApigatewayLogRetention();

        expect(apigatewayLogRetentionPlugin.getRestApiId).toHaveBeenCalledTimes(1);
        expect(apigatewayLogRetentionPlugin.getAccessLogGroupName).toHaveBeenCalledTimes(1);
        expect(apigatewayLogRetentionPlugin.getAccessLogGroupName).toHaveBeenCalledWith('1234', expect.anything());
        expect(apigatewayLogRetentionPlugin.updateRetentionPolicy).toHaveBeenCalledTimes(2);
        expect(apigatewayLogRetentionPlugin.updateRetentionPolicy).toHaveBeenNthCalledWith(
            1,
            '/aws/api-gateway/serverless-log-retention-demo-dev',
            7,
            expect.anything()
        );
        expect(apigatewayLogRetentionPlugin.updateRetentionPolicy).toHaveBeenNthCalledWith(
            2,
            'API-Gateway-Execution-Logs_1234/dev',
            14,
            expect.anything()
        );
        expect(serverless.cli.log).toHaveBeenNthCalledWith(
            1,
            'serverless-apigateway-log-retention - Successfully set ApiGateway access log (/aws/api-gateway/serverless-log-retention-demo-dev) retention to 7 days.'
        );
        expect(serverless.cli.log).toHaveBeenNthCalledWith(
            2,
            'serverless-apigateway-log-retention - Successfully set ApiGateway execution log (API-Gateway-Execution-Logs_1234/dev) retention to 14 days.',
        );
        expect(ProxyAgent).toHaveBeenCalledTimes(0);
    });

    test('uses proxy if HTTP_PROXY environment variable is configured', async () => {
        expect.assertions(2);
        process.env.HTTP_PROXY = 'http://HTTP_PROXY.com';
        serverless.service.custom = {
            apigatewayLogRetention: {
                accessLogging: { enabled: true, days: 7 },
                executionLogging: { enabled: true, days: 14 },
            },
        };
        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        apigatewayLogRetentionPlugin.getRestApiId = jest.fn().mockImplementation(() => '1234');
        apigatewayLogRetentionPlugin.getAccessLogGroupName = jest
            .fn()
            .mockImplementation(() => '/aws/api-gateway/serverless-log-retention-demo-dev');
        apigatewayLogRetentionPlugin.updateRetentionPolicy = jest.fn();

        await apigatewayLogRetentionPlugin.setApigatewayLogRetention();
        expect(ProxyAgent).toHaveBeenCalledTimes(1);
        expect(NodeHttpHandler).toHaveBeenCalledTimes(1);
    });

    test('uses proxy if HTTPS_PROXY environment variable is configured', async () => {
        expect.assertions(2);
        process.env.HTTPS_PROXY = 'http://HTTPS_PROXY.com';
        serverless.service.custom = {
            apigatewayLogRetention: {
                accessLogging: { enabled: true, days: 7 },
                executionLogging: { enabled: true, days: 14 },
            },
        };
        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        apigatewayLogRetentionPlugin.getRestApiId = jest.fn().mockImplementation(() => '1234');
        apigatewayLogRetentionPlugin.getAccessLogGroupName = jest
            .fn()
            .mockImplementation(() => '/aws/api-gateway/serverless-log-retention-demo-dev');
        apigatewayLogRetentionPlugin.updateRetentionPolicy = jest.fn();

        await apigatewayLogRetentionPlugin.setApigatewayLogRetention();
        expect(ProxyAgent).toHaveBeenCalledTimes(1);
        expect(NodeHttpHandler).toHaveBeenCalledTimes(1);
    });

    test('uses proxy if FTP_PROXY environment variable is configured', async () => {
        expect.assertions(2);
        process.env.FTP_PROXY = 'ftp://user@host/foo/bar.txt';
        serverless.service.custom = {
            apigatewayLogRetention: {
                accessLogging: { enabled: true, days: 7 },
                executionLogging: { enabled: true, days: 14 },
            },
        };
        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        apigatewayLogRetentionPlugin.getRestApiId = jest.fn().mockImplementation(() => '1234');
        apigatewayLogRetentionPlugin.getAccessLogGroupName = jest
            .fn()
            .mockImplementation(() => '/aws/api-gateway/serverless-log-retention-demo-dev');
        apigatewayLogRetentionPlugin.updateRetentionPolicy = jest.fn();

        await apigatewayLogRetentionPlugin.setApigatewayLogRetention();
        expect(ProxyAgent).toHaveBeenCalledTimes(1);
        expect(NodeHttpHandler).toHaveBeenCalledTimes(1);
    });

    test('uses proxy if WSS_PROXY environment variable is configured', async () => {
        expect.assertions(2);
        process.env.WSS_PROXY = 'wss://www.example.com/';
        serverless.service.custom = {
            apigatewayLogRetention: {
                accessLogging: { enabled: true, days: 7 },
                executionLogging: { enabled: true, days: 14 },
            },
        };
        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        apigatewayLogRetentionPlugin.getRestApiId = jest.fn().mockImplementation(() => '1234');
        apigatewayLogRetentionPlugin.getAccessLogGroupName = jest
            .fn()
            .mockImplementation(() => '/aws/api-gateway/serverless-log-retention-demo-dev');
        apigatewayLogRetentionPlugin.updateRetentionPolicy = jest.fn();

        await apigatewayLogRetentionPlugin.setApigatewayLogRetention();
        expect(ProxyAgent).toHaveBeenCalledTimes(1);
        expect(NodeHttpHandler).toHaveBeenCalledTimes(1);
    });

    test('uses proxy if WS_PROXY environment variable is configured', async () => {
        expect.assertions(2);
        process.env.WS_PROXY = 'ws://www.example.com/';
        serverless.service.custom = {
            apigatewayLogRetention: {
                accessLogging: { enabled: true, days: 7 },
                executionLogging: { enabled: true, days: 14 },
            },
        };
        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        apigatewayLogRetentionPlugin.getRestApiId = jest.fn().mockImplementation(() => '1234');
        apigatewayLogRetentionPlugin.getAccessLogGroupName = jest
            .fn()
            .mockImplementation(() => '/aws/api-gateway/serverless-log-retention-demo-dev');
        apigatewayLogRetentionPlugin.updateRetentionPolicy = jest.fn();

        await apigatewayLogRetentionPlugin.setApigatewayLogRetention();
        expect(ProxyAgent).toHaveBeenCalledTimes(1);
        expect(NodeHttpHandler).toHaveBeenCalledTimes(1);
    });

    test('does not use proxy if not configured', async () => {
        expect.assertions(1);
        process.env.HTTP_PROXY = '';
        process.env.HTTPS_PROXY = '';
        process.env.FTP_PROXY = '';
        process.env.WSS_PROXY = '';
        process.env.WS_PROXY = '';

        serverless.service.custom = {
            apigatewayLogRetention: {
                accessLogging: { enabled: true, days: 7 },
                executionLogging: { enabled: true, days: 14 },
            },
        };
        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        apigatewayLogRetentionPlugin.getRestApiId = jest.fn().mockImplementation(() => '1234');
        apigatewayLogRetentionPlugin.getAccessLogGroupName = jest
            .fn()
            .mockImplementation(() => '/aws/api-gateway/serverless-log-retention-demo-dev');
        apigatewayLogRetentionPlugin.updateRetentionPolicy = jest.fn();

        await apigatewayLogRetentionPlugin.setApigatewayLogRetention();
        expect(ProxyAgent).toHaveBeenCalledTimes(0);
    });

    test('uses AWS profile instead of default if provided', async () => {
        expect.assertions(4);
        serverless.service.custom = {
            apigatewayLogRetention: {
                accessLogging: { enabled: true, days: 7 },
                executionLogging: { enabled: true, days: 14 },
            },
        };
        serverless.service.provider.profile = 'test_profile';

        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        apigatewayLogRetentionPlugin.getRestApiId = jest.fn().mockImplementation(() => '1234');
        apigatewayLogRetentionPlugin.getAccessLogGroupName = jest
            .fn()
            .mockImplementation(() => '/aws/api-gateway/serverless-log-retention-demo-dev');
        apigatewayLogRetentionPlugin.updateRetentionPolicy = jest.fn();

        await apigatewayLogRetentionPlugin.setApigatewayLogRetention();
        expect(fromIni).toHaveBeenCalledTimes(3);
        expect(fromIni).toHaveBeenNthCalledWith(1, {'profile': 'test_profile'});
        expect(fromIni).toHaveBeenNthCalledWith(2, expect.anything());
        expect(fromIni).toHaveBeenNthCalledWith(2, expect.anything());
    });

    test('uses default AWS profile if profile was not provided', async () => {
        expect.assertions(3);
        serverless.service.custom = {
            apigatewayLogRetention: {
                accessLogging: { enabled: true, days: 7 },
                executionLogging: { enabled: true, days: 14 },
            },
        };
        serverless.service.provider.profile = '';

        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        apigatewayLogRetentionPlugin.getRestApiId = jest.fn().mockImplementation(() => '1234');
        apigatewayLogRetentionPlugin.getAccessLogGroupName = jest
            .fn()
            .mockImplementation(() => '/aws/api-gateway/serverless-log-retention-demo-dev');
        apigatewayLogRetentionPlugin.updateRetentionPolicy = jest.fn();

        await apigatewayLogRetentionPlugin.setApigatewayLogRetention();
        expect(fromIni).toHaveBeenCalledTimes(2);
        expect(fromIni).toHaveBeenNthCalledWith(1, expect.anything());
        expect(fromIni).toHaveBeenNthCalledWith(2, expect.anything());
    });
});
