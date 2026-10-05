@description('Azure region of the Application Insights component; the availability test must be in the same region.')
param appInsightsLocation string

@description('Azure region for the Slack notifier Logic App.')
param location string

@description('Resource ID of the Application Insights component.')
param appInsightsId string

@description('Resource ID of the Log Analytics Workspace that Application Insights writes to.')
param workspaceId string

@description('Resource ID of the App Service (backend API).')
param appServiceId string

@description('Resource ID of the SQL Database.')
param sqlDatabaseId string

@description('Resource ID of the frontend Storage Account.')
param storageAccountId string

@description('Default HTTPS URL of the backend App Service, without a trailing slash.')
param apiUrl string

@description('Email address that receives alert emails and Azure mobile app push notifications.')
param alertEmail string

@description('Slack incoming webhook URL for alert messages. Leave empty to skip Slack notifications.')
@secure()
param slackWebhookUrl string = ''

@description('Monthly cost budget for the resource group, in the billing currency.')
param monthlyBudget int = 10

@description('First day of the month the budget was created in (YYYY-MM-01). Budgets can\'t move their start date once created.')
param budgetStartDate string

// Cloud role name the frontend's telemetry initializer sets (frontend/src/telemetry.ts).
var frontendRoleName = 'CheckMate.Web'

// The Azure SQL free offer includes 100,000 vCore-seconds a month; alert when 20% is left.
var sqlFreeVCoreSecondsThreshold = 20000

var slackEnabled = !empty(slackWebhookUrl)

// Azure's alert payloads aren't in Slack's format, so this Logic App turns them into a Slack message and posts it
// to the incoming webhook. Budgets send their own schema rather than the common alert schema, so they get their
// own message.
var commonAlertMessage = '''
@{if(equals(outputs('Parse_payload')?['data']?['essentials']?['monitorCondition'], 'Resolved'), ':white_check_mark: *Resolved*', ':rotating_light: *Fired*')} @{outputs('Parse_payload')?['data']?['essentials']?['severity']} *@{outputs('Parse_payload')?['data']?['essentials']?['alertRule']}*
@{coalesce(outputs('Parse_payload')?['data']?['essentials']?['description'], '')}
Resource: @{last(split(coalesce(first(outputs('Parse_payload')?['data']?['essentials']?['alertTargetIDs']), 'n/a'), '/'))}
Fired: @{outputs('Parse_payload')?['data']?['essentials']?['firedDateTime']}
<https://portal.azure.com/#blade/Microsoft_Azure_Monitoring_Alerts/AlertDetailsTemplateBlade/alertId/@{encodeUriComponent(coalesce(outputs('Parse_payload')?['data']?['essentials']?['alertId'], ''))}|Open the alert in the Azure portal>'''

var budgetAlertMessage = '''
:moneybag: *Budget alert* *@{outputs('Parse_payload')?['data']?['BudgetName']}*
Spent @{outputs('Parse_payload')?['data']?['SpendingAmount']} @{outputs('Parse_payload')?['data']?['Unit']} of the @{outputs('Parse_payload')?['data']?['Budget']} @{outputs('Parse_payload')?['data']?['Unit']} budget (alert at @{mul(float(coalesce(outputs('Parse_payload')?['data']?['NotificationThresholdAmount'], '0')), 100)}%) since @{outputs('Parse_payload')?['data']?['BudgetStartDate']}.
<@{parameters('resourceGroupUrl')}|Open the resource group in the Azure portal> (Cost Management > Budgets)'''

resource slackNotifier 'Microsoft.Logic/workflows@2019-05-01' = if (slackEnabled) {
  name: 'CheckMate-SlackAlerts'
  location: location
  properties: {
    state: 'Enabled'
    parameters: {
      slackWebhookUrl: {
        value: slackWebhookUrl
      }
      resourceGroupUrl: {
        value: 'https://portal.azure.com/#@/resource${resourceGroup().id}'
      }
    }
    definition: {
      '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#'
      contentVersion: '1.0.0.0'
      parameters: {
        slackWebhookUrl: {
          type: 'securestring'
        }
        resourceGroupUrl: {
          type: 'string'
        }
      }
      triggers: {
        manual: {
          type: 'Request'
          kind: 'Http'
          inputs: {
            schema: {
              type: 'object'
            }
          }
        }
      }
      actions: {
        // Action groups may not send a JSON content type, so parse the body whether it arrives as a string or an
        // object.
        Parse_payload: {
          type: 'Compose'
          runAfter: {}
          inputs: '@json(string(triggerBody()))'
        }
        Is_budget_alert: {
          type: 'If'
          runAfter: {
            Parse_payload: ['Succeeded']
          }
          expression: {
            and: [
              {
                not: {
                  equals: [
                    '@coalesce(outputs(\'Parse_payload\')?[\'data\']?[\'BudgetName\'], \'\')'
                    ''
                  ]
                }
              }
            ]
          }
          actions: {
            Post_budget_alert_to_Slack: {
              type: 'Http'
              runAfter: {}
              inputs: {
                method: 'POST'
                uri: '@parameters(\'slackWebhookUrl\')'
                body: {
                  text: budgetAlertMessage
                }
              }
            }
          }
          else: {
            actions: {
              Post_alert_to_Slack: {
                type: 'Http'
                runAfter: {}
                inputs: {
                  method: 'POST'
                  uri: '@parameters(\'slackWebhookUrl\')'
                  body: {
                    text: commonAlertMessage
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'CheckMate-Alerts'
  location: 'global'
  properties: {
    groupShortName: 'CheckMate'
    enabled: true
    emailReceivers: [
      {
        name: 'Email'
        emailAddress: alertEmail
        useCommonAlertSchema: true
      }
    ]
    azureAppPushReceivers: [
      {
        name: 'AzureMobileApp'
        emailAddress: alertEmail
      }
    ]
    logicAppReceivers: slackEnabled
      ? [
          {
            name: 'Slack'
            resourceId: slackNotifier.id
            callbackUrl: listCallbackUrl('${slackNotifier.id}/triggers/manual', '2019-05-01').value
            useCommonAlertSchema: true
          }
        ]
      : []
  }
}

var actions = [
  {
    actionGroupId: actionGroup.id
  }
]

// Pings a lightweight endpoint that doesn't touch SQL, so the serverless database can still auto-pause.
// One location every 15 minutes (the longest interval allowed) keeps the cost to a couple of dollars a month.
var availabilityTestName = 'CheckMate API health'

resource availabilityTest 'Microsoft.Insights/webtests@2022-06-15' = {
  name: 'checkmate-api-health'
  location: appInsightsLocation
  tags: {
    'hidden-link:${appInsightsId}': 'Resource'
  }
  kind: 'standard'
  properties: {
    SyntheticMonitorId: 'checkmate-api-health'
    Name: availabilityTestName
    Kind: 'standard'
    Enabled: true
    Frequency: 900
    // Allows for an F1 cold start, which can take most of a minute.
    Timeout: 60
    RetryEnabled: true
    Locations: [
      {
        Id: 'us-ca-sjc-azr'
      }
    ]
    Request: {
      RequestUrl: '${apiUrl}/health'
      HttpVerb: 'GET'
      ParseDependentRequests: false
    }
    ValidationRules: {
      ExpectedHttpStatusCode: 200
      SSLCheck: true
      SSLCertRemainingLifetimeCheck: 7
    }
  }
}

// Metric alerts. A missing `dimensions` means no filter; `timeAggregation` must be one the metric supports.
var metricAlerts = [
  {
    name: 'CheckMate API down'
    description: 'The API health availability test failed twice in a row.'
    severity: 1
    scope: appInsightsId
    namespace: 'microsoft.insights/components'
    metric: 'availabilityResults/availabilityPercentage'
    timeAggregation: 'Average'
    operator: 'LessThan'
    threshold: 50
    windowSize: 'PT30M'
    frequency: 'PT5M'
    dimensions: [
      {
        name: 'availabilityResult/name'
        operator: 'Include'
        values: [availabilityTestName]
      }
    ]
  }
  {
    name: 'CheckMate API server errors'
    description: 'The API returned more than 5 HTTP 5xx responses in 15 minutes.'
    severity: 2
    scope: appServiceId
    namespace: 'Microsoft.Web/sites'
    metric: 'Http5xx'
    timeAggregation: 'Total'
    operator: 'GreaterThan'
    threshold: 5
    windowSize: 'PT15M'
    frequency: 'PT5M'
    dimensions: []
  }
  {
    name: 'CheckMate API dependency failures'
    description: 'The API had more than 10 failed dependency calls (mostly SQL) in 15 minutes, more than auto-pause resume retries explain.'
    severity: 2
    scope: appInsightsId
    namespace: 'microsoft.insights/components'
    metric: 'dependencies/failed'
    timeAggregation: 'Count'
    operator: 'GreaterThan'
    threshold: 10
    windowSize: 'PT15M'
    frequency: 'PT5M'
    dimensions: [
      {
        name: 'cloud/roleName'
        operator: 'Exclude'
        values: [frontendRoleName]
      }
    ]
  }
  {
    name: 'CheckMate browser errors'
    description: 'The frontend reported more than 5 exceptions in an hour.'
    severity: 2
    scope: appInsightsId
    namespace: 'microsoft.insights/components'
    metric: 'exceptions/browser'
    timeAggregation: 'Count'
    operator: 'GreaterThan'
    threshold: 5
    windowSize: 'PT1H'
    frequency: 'PT15M'
    dimensions: []
  }
  {
    name: 'CheckMate browser API call failures'
    description: 'More than 5 API calls from the frontend failed in an hour (network, CORS or server errors).'
    severity: 2
    scope: appInsightsId
    namespace: 'microsoft.insights/components'
    metric: 'dependencies/failed'
    timeAggregation: 'Count'
    operator: 'GreaterThan'
    threshold: 5
    windowSize: 'PT1H'
    frequency: 'PT15M'
    dimensions: [
      {
        name: 'cloud/roleName'
        operator: 'Include'
        values: [frontendRoleName]
      }
    ]
  }
  {
    name: 'CheckMate CPU quota'
    description: 'The API used more than 75% of the F1 plan\'s 60 CPU-minute daily quota in the last 24 hours. The app stops when the quota runs out.'
    severity: 2
    scope: appServiceId
    namespace: 'Microsoft.Web/sites'
    metric: 'CpuTime'
    timeAggregation: 'Total'
    operator: 'GreaterThan'
    threshold: 2700
    windowSize: 'P1D'
    frequency: 'PT1H'
    dimensions: []
  }
  {
    name: 'CheckMate SQL free offer running out'
    description: 'Less than 20% of this month\'s free SQL vCore-seconds remain. When they run out the database pauses until next month.'
    severity: 2
    scope: sqlDatabaseId
    namespace: 'Microsoft.Sql/servers/databases'
    metric: 'free_amount_remaining'
    timeAggregation: 'Minimum'
    operator: 'LessThan'
    threshold: sqlFreeVCoreSecondsThreshold
    windowSize: 'PT1H'
    frequency: 'PT1H'
    dimensions: []
  }
  {
    name: 'CheckMate frontend storage availability'
    description: 'Blob storage, which serves the frontend, was less than 99% available over an hour.'
    severity: 2
    scope: '${storageAccountId}/blobServices/default'
    namespace: 'Microsoft.Storage/storageAccounts/blobServices'
    metric: 'Availability'
    timeAggregation: 'Average'
    operator: 'LessThan'
    threshold: 99
    windowSize: 'PT1H'
    frequency: 'PT15M'
    dimensions: []
  }
  {
    name: 'CheckMate slow API'
    description: 'The API\'s average response time was over 5 seconds for 30 minutes.'
    severity: 3
    scope: appServiceId
    namespace: 'Microsoft.Web/sites'
    metric: 'HttpResponseTime'
    timeAggregation: 'Average'
    operator: 'GreaterThan'
    threshold: 5
    windowSize: 'PT30M'
    frequency: 'PT5M'
    dimensions: []
  }
  {
    name: 'CheckMate SQL storage'
    description: 'The database has used more than 80% of its maximum size.'
    severity: 3
    scope: sqlDatabaseId
    namespace: 'Microsoft.Sql/servers/databases'
    metric: 'storage_percent'
    timeAggregation: 'Maximum'
    operator: 'GreaterThan'
    threshold: 80
    windowSize: 'PT1H'
    frequency: 'PT15M'
    dimensions: []
  }
]

resource metricAlertRules 'Microsoft.Insights/metricAlerts@2018-03-01' = [
  for alert in metricAlerts: {
    name: alert.name
    location: 'global'
    properties: {
      description: alert.description
      severity: alert.severity
      enabled: true
      scopes: [alert.scope]
      evaluationFrequency: alert.frequency
      windowSize: alert.windowSize
      autoMitigate: true
      criteria: {
        'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
        allOf: [
          {
            criterionType: 'StaticThresholdCriterion'
            name: 'Condition'
            metricNamespace: alert.namespace
            metricName: alert.metric
            timeAggregation: alert.timeAggregation
            operator: alert.operator
            threshold: alert.threshold
            dimensions: alert.dimensions
          }
        ]
      }
      actions: actions
    }
  }
]

// Needs at least 5 page loads so one slow phone on bad wifi doesn't alert.
resource slowPageLoads 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: 'CheckMate slow page loads'
  location: location
  properties: {
    displayName: 'CheckMate slow page loads'
    description: 'The 75th percentile frontend page load time was over 4 seconds in the last 6 hours.'
    severity: 3
    enabled: true
    scopes: [workspaceId]
    evaluationFrequency: 'PT1H'
    windowSize: 'PT6H'
    autoMitigate: true
    criteria: {
      allOf: [
        {
          query: 'AppPageViews\n| where AppRoleName == "${frontendRoleName}"\n| summarize Samples = count(), P75 = percentile(DurationMs, 75)\n| where Samples >= 5 and P75 > 4000'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: [actionGroup.id]
    }
  }
}

// Azure creates this rule along with Application Insights and allows only one per component, so use the name it
// gives it; the template then takes over the existing rule instead of trying to add a second.
resource failureAnomalies 'Microsoft.AlertsManagement/smartDetectorAlertRules@2021-04-01' = {
  name: 'Failure Anomalies - ${last(split(appInsightsId, '/'))}'
  location: 'global'
  properties: {
    description: 'Unusual rise in the rate of failed requests or dependency calls.'
    state: 'Enabled'
    severity: 'Sev3'
    frequency: 'PT1M'
    detector: {
      id: 'FailureAnomaliesDetector'
    }
    scope: [appInsightsId]
    actionGroups: {
      groupIds: [actionGroup.id]
    }
  }
}

// Only outages Azure causes; restarts and deployments we start ourselves are left out.
resource resourceHealth 'Microsoft.Insights/activityLogAlerts@2020-10-01' = {
  name: 'CheckMate resource health'
  location: 'global'
  properties: {
    description: 'A CheckMate resource became unavailable or degraded because of an Azure platform issue.'
    enabled: true
    scopes: [resourceGroup().id]
    condition: {
      allOf: [
        {
          field: 'category'
          equals: 'ResourceHealth'
        }
        {
          anyOf: [
            {
              field: 'properties.currentHealthStatus'
              equals: 'Unavailable'
            }
            {
              field: 'properties.currentHealthStatus'
              equals: 'Degraded'
            }
          ]
        }
        {
          field: 'properties.cause'
          equals: 'PlatformInitiated'
        }
      ]
    }
    actions: {
      actionGroups: [
        {
          actionGroupId: actionGroup.id
        }
      ]
    }
  }
}

// Service Health events are subscription-wide, so filter to the services and regions CheckMate uses.
resource serviceHealth 'Microsoft.Insights/activityLogAlerts@2020-10-01' = {
  name: 'CheckMate service health'
  location: 'global'
  properties: {
    description: 'Azure reported an incident or planned maintenance affecting a service or region CheckMate uses.'
    enabled: true
    scopes: [subscription().id]
    condition: {
      allOf: [
        {
          field: 'category'
          equals: 'ServiceHealth'
        }
        {
          anyOf: [
            {
              field: 'properties.incidentType'
              equals: 'Incident'
            }
            {
              field: 'properties.incidentType'
              equals: 'Maintenance'
            }
          ]
        }
        {
          field: 'properties.impactedServices[*].ServiceName'
          containsAny: [
            'App Service'
            'App Service (Linux)'
            'SQL Database'
            'Storage'
            'Application Insights'
            'Azure Monitor'
          ]
        }
        {
          field: 'properties.impactedServices[*].ImpactedRegions[*].RegionName'
          containsAny: [
            'West US'
            'West US 2'
            'Global'
          ]
        }
      ]
    }
    actions: {
      actionGroups: [
        {
          actionGroupId: actionGroup.id
        }
      ]
    }
  }
}

resource budget 'Microsoft.Consumption/budgets@2024-08-01' = {
  name: 'CheckMate-Monthly'
  properties: {
    category: 'Cost'
    amount: monthlyBudget
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budgetStartDate
    }
    notifications: {
      actual80: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 80
        thresholdType: 'Actual'
        contactEmails: [alertEmail]
        contactGroups: [actionGroup.id]
      }
      forecast100: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: [alertEmail]
        contactGroups: [actionGroup.id]
      }
    }
  }
}

@description('Resource ID of the alerts action group.')
output actionGroupId string = actionGroup.id
