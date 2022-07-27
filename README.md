# ApiGateway Log Retention

Control the retention of your ApiGateway access logs and execution logs.

## Installation
From your target serverless project, run:

`npm install serverless-apigateway-log-retention`

Add the plugin to your serverless.yml:
```
plugins:
  - serverless-apigateway-log-retention
```

## Configuration
Configuration happens 'globally' via custom.apigatewayLogRetention

PLEASE NOTE THAT THE PLUGIN REQUIRES THE FOLLOWING AWS PERMISSIONS:

**CloudWatch Logs**
* putRetentionPolicy
* deleteRetentionPolicy

**ApiGateway**
* getRestApis
* getStage

**Plugin Options**

`accessLogging.enabled` (optional) - Whether or not to update access logging retention policy. Set to false by default.

`accessLogging.days` (required) - Possible values are: 1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1827, 3653 and 'never expire'.

`executionLogging.enabled` (optional) - Whether or not to update execution logging retention policy. Set to false by default.

`executionLogging.days` (required) - Possible values are: 1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1827, 3653 and 'never expire'.

## Examples
`serverless.yml` - Enabled for execution logging and disabled for access logging:
```yml
service: sample

plugins:
  - serverless-apigateway-log-retention

provider:
  name: aws

custom:
  apigatewayLogRetention:
    executionLogging:
      enabled: true
      days: 'never expire'
```
\
`serverless.yml` - Enabled for access logging and execution logging:
```yml
service: sample

plugins:
  - serverless-apigateway-log-retention

provider:
  name: aws

custom:
  apigatewayLogRetention:
    executionLogging:
      enabled: true
      days: 14
    accessLogging:
      enabled: true
      days: 7
```
