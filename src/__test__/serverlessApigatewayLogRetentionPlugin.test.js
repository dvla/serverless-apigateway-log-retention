/* eslint-disable max-len */
const awsMock = require('aws-sdk-mock');
const Plugin = require('../serverlessApigatewayLogRetentionPlugin');

const mockPutRetentionPolicyCallback = jest.fn();
const mockDeleteRetentionPolicyCallback = jest.fn();
const mockGetRestApisCallback = jest.fn();
const mockGetStageCallback = jest.fn();

let serverless;
let options;

beforeEach(() => {
    serverless = {
        cli: { log: jest.fn() },
        getProvider: () => ({
            getRegion: () => 'eu-west-2',
        }),
        service: {
            getServiceName: () => 'serverless-log-retention-demo',
            custom: {},
        },
    };
    options = {
        stage: 'dev',
    };
});

afterEach(() => {
    awsMock.restore();
    mockPutRetentionPolicyCallback.mockReset();
    mockDeleteRetentionPolicyCallback.mockReset();
    mockGetRestApisCallback.mockReset();
    mockGetStageCallback.mockReset();
    jest.clearAllMocks();
    jest.resetModules();
});

describe('setLogRetention', () => {
    test('sets log retention policy on log group correctly when days is set to an integer', async () => {
        awsMock.mock('CloudWatchLogs', 'putRetentionPolicy', (params, callback) => {
            mockPutRetentionPolicyCallback(params);
            callback('', {});
        });

        const expectedPutRetentionPolicyCallbackParams = {
            logGroupName: 'API-Gateway-Execution-Logs_12abcdefgh/dev',
            retentionInDays: 7,
        };

        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        await apigatewayLogRetentionPlugin.updateRetentionPolicy('API-Gateway-Execution-Logs_12abcdefgh/dev', 7);

        expect(mockPutRetentionPolicyCallback).toHaveBeenCalledTimes(1);
        expect(mockPutRetentionPolicyCallback).toHaveBeenCalledWith(expectedPutRetentionPolicyCallbackParams);
    });

    test("deletes log retention policy on log group correctly when days is set to 'never expire'", async () => {
        awsMock.mock('CloudWatchLogs', 'deleteRetentionPolicy', (params, callback) => {
            mockDeleteRetentionPolicyCallback(params);
            callback('', {});
        });

        const expectedDeleteRetentionPolicyStageCallbackParams = {
            logGroupName: 'API-Gateway-Execution-Logs_12abcdefgh/dev',
        };

        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        await apigatewayLogRetentionPlugin.updateRetentionPolicy(
            'API-Gateway-Execution-Logs_12abcdefgh/dev',
            'Never ExPire'
        );

        expect(mockPutRetentionPolicyCallback).toHaveBeenCalledTimes(0);
        expect(mockDeleteRetentionPolicyCallback).toHaveBeenCalledTimes(1);
        expect(mockDeleteRetentionPolicyCallback).toHaveBeenCalledWith(
            expectedDeleteRetentionPolicyStageCallbackParams
        );
    });

    test('throws error if putRetentionPolicy call erred', async () => {
        const mockAwsError = new Error('some aws error');

        awsMock.mock('CloudWatchLogs', 'putRetentionPolicy', (params, callback) => {
            mockPutRetentionPolicyCallback(params);
            callback(mockAwsError);
        });

        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);

        await expect(
            apigatewayLogRetentionPlugin.updateRetentionPolicy('API-Gateway-Execution-Logs_12abcdefgh/dev', '7')
        ).rejects.toThrow(mockAwsError);
        expect(mockPutRetentionPolicyCallback).toHaveBeenCalledTimes(1);
    });

    test('throws error if deleteRetentionPolicy call erred', async () => {
        const mockAwsError = new Error('some aws error');

        awsMock.mock('CloudWatchLogs', 'deleteRetentionPolicy', (params, callback) => {
            mockDeleteRetentionPolicyCallback(params);
            callback(mockAwsError);
        });

        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);

        await expect(
            apigatewayLogRetentionPlugin.updateRetentionPolicy(
                'API-Gateway-Execution-Logs_12abcdefgh/dev',
                'NEVER expire'
            )
        ).rejects.toThrow(mockAwsError);
        expect(mockDeleteRetentionPolicyCallback).toHaveBeenCalledTimes(1);
    });
});

describe('getRestApiId', () => {
    test('returns API ID if there exists an API name matching the stack name', async () => {
        awsMock.mock('APIGateway', 'getRestApis', (params, callback) => {
            mockGetRestApisCallback(params);
            callback('', {
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
        });

        const expectedGetRestApisCallback = {
            limit: 500,
        };

        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        const returnedApiId = await apigatewayLogRetentionPlugin.getRestApiId();

        expect(mockGetRestApisCallback).toHaveBeenCalledTimes(1);
        expect(mockGetRestApisCallback).toHaveBeenCalledWith(expectedGetRestApisCallback);
        expect(returnedApiId).toEqual('1');
    });

    test('throws error if there is no API name matching the deployed stack name', async () => {
        awsMock.mock('APIGateway', 'getRestApis', (params, callback) => {
            mockGetRestApisCallback(params);
            callback('', {
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
        });

        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        const expectedError = new Error('Api dev-serverless-log-retention-demo does not exist.');

        await expect(apigatewayLogRetentionPlugin.getRestApiId()).rejects.toThrow(expectedError);
        expect(mockGetRestApisCallback).toHaveBeenCalledTimes(1);
    });

    test('throws error if getRestApis call erred', async () => {
        const mockAwsError = new Error('some aws error');

        awsMock.mock('APIGateway', 'getRestApis', (params, callback) => {
            mockGetRestApisCallback(params);
            callback(mockAwsError);
        });
        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);

        await expect(apigatewayLogRetentionPlugin.getRestApiId()).rejects.toThrow(mockAwsError);
        expect(mockGetRestApisCallback).toHaveBeenCalledTimes(1);
    });
});

describe('getAccessLogGroupName', () => {
    test('returns access log group name given rest API ID and stage', async () => {
        awsMock.mock('APIGateway', 'getStage', (params, callback) => {
            mockGetStageCallback(params);
            callback('', {
                id: '1',
                accessLogSettings: {
                    destinationArn:
                        'arn:aws:logs:eu-west-2:123456789123:log-group:/aws/api-gateway/serverless-log-retention-demo-dev',
                },
            });
        });

        const expectedGetStageCallback = {
            restApiId: '1',
            stageName: options.stage,
        };

        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        const returnedAccessLogGroupName = await apigatewayLogRetentionPlugin.getAccessLogGroupName('1');

        expect(mockGetStageCallback).toHaveBeenCalledTimes(1);
        expect(mockGetStageCallback).toHaveBeenCalledWith(expectedGetStageCallback);
        expect(returnedAccessLogGroupName).toEqual('/aws/api-gateway/serverless-log-retention-demo-dev');
    });

    test('throws error if access log ARN not set', async () => {
        awsMock.mock('APIGateway', 'getStage', (params, callback) => {
            mockGetStageCallback(params);
            callback('', {
                id: '1',
                accessLogSettings: {
                    destinationArn: '',
                },
            });
        });

        const expectedError = new Error(
            'Access log destination ARN not set! Please check access logging is enabled and destination ARN is configured in ApiGateway > stage > Logs/Tracing.'
        );
        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);

        await expect(apigatewayLogRetentionPlugin.getAccessLogGroupName('1')).rejects.toThrow(expectedError);
    });

    test('throws error if access logs not turned on', async () => {
        awsMock.mock('APIGateway', 'getStage', (params, callback) => {
            mockGetStageCallback(params);
            callback('', {
                id: '1',
            });
        });

        const expectedError = new Error(
            'Access log destination ARN not set! Please check access logging is enabled and destination ARN is configured in ApiGateway > stage > Logs/Tracing.'
        );
        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);

        await expect(apigatewayLogRetentionPlugin.getAccessLogGroupName('1')).rejects.toThrow(expectedError);
    });

    test('throws error if getStage call erred', async () => {
        const mockAwsError = new Error('some aws error');

        awsMock.mock('APIGateway', 'getStage', (params, callback) => {
            mockGetStageCallback(params);
            callback(mockAwsError);
        });

        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);

        await expect(apigatewayLogRetentionPlugin.getAccessLogGroupName('1')).rejects.toThrow(mockAwsError);
    });
});

describe('setApigatewayLogRetention', () => {
    test('returns early if access logging and execution logging is disabled', async () => {
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
        const apigatewayLogRetentionPlugin = new Plugin(serverless, options);
        apigatewayLogRetentionPlugin.getRestApiId = jest.fn();

        await apigatewayLogRetentionPlugin.setApigatewayLogRetention();

        expect(apigatewayLogRetentionPlugin.getRestApiId).toHaveBeenCalledTimes(0);
    });

    test("errors correctly if rest api id couldn't be fetched", async () => {
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
        expect(apigatewayLogRetentionPlugin.getAccessLogGroupName).toHaveBeenCalledWith('1234');
        expect(apigatewayLogRetentionPlugin.updateRetentionPolicy).toHaveBeenCalledTimes(2);
        expect(apigatewayLogRetentionPlugin.updateRetentionPolicy).toHaveBeenNthCalledWith(
            1,
            '/aws/api-gateway/serverless-log-retention-demo-dev',
            7
        );
        expect(apigatewayLogRetentionPlugin.updateRetentionPolicy).toHaveBeenNthCalledWith(
            2,
            'API-Gateway-Execution-Logs_1234/dev',
            14
        );
        expect(serverless.cli.log).toHaveBeenNthCalledWith(
            1,
            'serverless-apigateway-log-retention - Successfully set ApiGateway access log (/aws/api-gateway/serverless-log-retention-demo-dev) retention to 7 days.'
        );
        expect(serverless.cli.log).toHaveBeenNthCalledWith(
            2,
            'serverless-apigateway-log-retention - Successfully set ApiGateway execution log (API-Gateway-Execution-Logs_1234/dev) retention to 14 days.'
        );
    });
});
