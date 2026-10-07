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

@description('GitHub token that can start the alert investigation workflow (Actions: read and write). Leave empty to skip Claude alert investigations.')
@secure()
param alertInvestigationToken string = ''

@description('GitHub repository (owner/name) that runs the alert investigation workflow.')
param githubRepository string

@description('Monthly cost budget for the resource group, in the billing currency.')
param monthlyBudget int = 10

@description('First day of the month the budget was created in (YYYY-MM-01). Budgets can\'t move their start date once created.')
param budgetStartDate string

// Cloud role name the frontend's telemetry initializer sets (frontend/src/telemetry.ts).
var frontendRoleName = 'CheckMate.Web'

// The Azure SQL free offer includes 100,000 vCore-seconds a month; alert when 20% is left.
var sqlFreeVCoreSecondsThreshold = 20000

var slackEnabled = !empty(slackWebhookUrl)

// Claude's findings go to the same Slack channel, so investigations need Slack too.
var investigationEnabled = slackEnabled && !empty(alertInvestigationToken)

// Rule names the Slack messages look up "What to do" steps by. Azure names the Failure Anomalies rule itself.
var slowApiName = 'CheckMate slow API'
var slowPageLoadsName = 'CheckMate slow page loads'
var failureAnomaliesName = 'Failure Anomalies - ${last(split(appInsightsId, '/'))}'
var resourceHealthName = 'CheckMate resource health'
var serviceHealthName = 'CheckMate service health'

// Slack-formatted links for the "What to do" steps.
var portalResource = 'https://portal.azure.com/#resource'
// workbook.bicep depends on this module's action group, so build its deterministic ID here instead of passing it in.
var workbookUrl = '${portalResource}${resourceGroup().id}/providers/Microsoft.Insights/workbooks/${guid(resourceGroup().id, 'checkmate-health-workbook')}/workbook'
var workbookLink = '<${workbookUrl}|CheckMate Health workbook>'
var ciRunsLink = '<https://github.com/dylan-smith/CheckMate/actions/workflows/ci.yml?query=branch%3Amain|CI runs on main>'
var loadTestRunsLink = '<https://github.com/dylan-smith/CheckMate/actions/workflows/load-test.yml|Generate Load runs>'
var failuresLink = '<${portalResource}${appInsightsId}/failures|Failures>'
var performanceLink = '<${portalResource}${appInsightsId}/performance|Performance>'
var availabilityLink = '<${portalResource}${appInsightsId}/availability|Availability>'
var logStreamLink = '<${portalResource}${appServiceId}/logStream|Log stream>'
var troubleshootLink = '<${portalResource}${appServiceId}/troubleshoot|Diagnose and solve problems>'
var appServiceLink = '<${portalResource}${appServiceId}/overview|App Service>'
var queryPerformanceLink = '<${portalResource}${sqlDatabaseId}/queryPerformanceInsight|Query Performance Insight>'
var resourceHealthLinks = 'resource health for the <${portalResource}${appServiceId}/resourceHealth|App Service>, <${portalResource}${sqlDatabaseId}/resourceHealth|SQL database> and <${portalResource}${storageAccountId}/resourceHealth|Storage account>'
var serviceHealthLink = '<https://portal.azure.com/#view/Microsoft_Azure_Health/AzureHealthBrowseBlade/~/serviceIssues|Service Health>'
var azureStatusLink = '<https://azure.status.microsoft/status|Azure status>'
var healthEndpointLink = '<${apiUrl}/health|/health>'

var apiServerErrorSteps = [
  'On the *API* tab of the ${workbookLink}, check *Failed requests* for the operations and status codes that are failing, and *API exceptions* for the errors behind them.'
  'Open ${failuresLink}, pick the failing operation, then a sample to see the exception and its end-to-end transaction.'
  'Check whether it started with a deployment (the workbook\'s charts mark each one, or see the ${ciRunsLink}). If it did, revert the change on `main`.'
  'If the exceptions are SQL errors, follow the steps for *CheckMate API dependency failures*.'
]

// The numbered steps posted with each fired alert, keyed by alert rule name.
var alertSteps = union(
  toObject(metricAlerts, alert => alert.name, alert => alert.steps),
  {
    '${slowApiName}': [
      'On the *API* tab of the ${workbookLink}, check *Operations* and *SQL call duration* for what\'s slow. ${performanceLink} breaks it down further.'
      'Cold starts and database resumes make a few requests slow; if that\'s all it is, close the alert.'
      'If SQL is slow, check ${queryPerformanceLink}. If everything is slow, check whether the CPU quota is nearly used up.'
    ]
    '${slowPageLoadsName}': [
      'On the *Frontend* tab of the ${workbookLink}, check *Page load time* for the slow pages, and *Browser-observed API duration*.'
      'If the API calls are slow, follow the steps for *CheckMate slow API*. Otherwise check whether a recent frontend deployment (${ciRunsLink}) made the bundle bigger or added work on load.'
    ]
    '${failureAnomaliesName}': apiServerErrorSteps
    '${resourceHealthName}': [
      'Azure caused this, so there\'s usually nothing to fix on our side. Check ${resourceHealthLinks} to see which one and Azure\'s explanation.'
      'Check the *Overview* tab of the ${workbookLink} to see whether users are affected, and ${azureStatusLink} for a wider outage.'
      'Wait for the resolved message. If the resource stays unavailable for a long time, open a support request from its resource health page.'
    ]
    '${serviceHealthName}': [
      'Read the incident or maintenance notice, and its updates, in ${serviceHealthLink}.'
      'Check the *Overview* tab of the ${workbookLink} to see whether CheckMate is actually affected. Often it isn\'t.'
      'There\'s nothing to fix on our side; follow the notice until Azure resolves it.'
    ]
  }
)

// Azure's alert payloads aren't in Slack's format, so this Logic App turns them into a Slack message and posts it
// to the incoming webhook. Budgets send their own schema rather than the common alert schema, so they get their
// own message. Values used in only one branch of an if() still get a fallback, in case the unused branch is evaluated.
var measuredLine = '''
@{if(equals(outputs('Criterion')?['metricValue'], null), '', concat('*Measured:* ', coalesce(outputs('Criterion')?['metricName'], 'query results'), ' (', coalesce(outputs('Criterion')?['timeAggregation'], 'Count'), ' over ', replace(replace(replace(replace(replace(coalesce(outputs('Parse_payload')?['data']?['alertContext']?['condition']?['windowSize'], ''), 'PT', ''), 'P', ''), 'D', ' day'), 'H', ' h'), 'M', ' min'), ') was *', formatNumber(float(string(coalesce(outputs('Criterion')?['metricValue'], 0))), '0.##'), '*; the alert fires when it is ', coalesce(parameters('operators')?[coalesce(outputs('Criterion')?['operator'], '')], outputs('Criterion')?['operator'], ''), ' ', formatNumber(float(string(coalesce(outputs('Criterion')?['threshold'], 0))), '0.##'), '.', decodeUriComponent('%0A')))}'''

var azureSaysLine = '''
@{if(empty(coalesce(outputs('Parse_payload')?['data']?['alertContext']?['properties']?['title'], '')), '', concat('*Azure says:* ', outputs('Parse_payload')?['data']?['alertContext']?['properties']?['title'], if(empty(coalesce(outputs('Parse_payload')?['data']?['alertContext']?['properties']?['currentHealthStatus'], '')), '', concat(' (', outputs('Parse_payload')?['data']?['alertContext']?['properties']?['currentHealthStatus'], ')')), decodeUriComponent('%0A')))}'''

// Slack shows <!date^...> in each reader's own time zone.
var commonAlertMessage = '''
@{if(equals(outputs('Essentials')?['monitorCondition'], 'Resolved'), ':white_check_mark: *Resolved*', ':rotating_light: *Fired*')} @{outputs('Essentials')?['severity']} *@{outputs('Essentials')?['alertRule']}*
@{coalesce(outputs('Essentials')?['description'], '')}
@{outputs('Measured_line')}@{outputs('Azure_says_line')}*Resource:* <https://portal.azure.com/#resource@{coalesce(first(outputs('Essentials')?['alertTargetIDs']), '')}/overview|@{last(split(coalesce(first(outputs('Essentials')?['alertTargetIDs']), 'n/a'), '/'))}>
*@{if(equals(outputs('Essentials')?['monitorCondition'], 'Resolved'), 'Resolved', 'Fired')}:* <!date^@{div(sub(ticks(outputs('Event_time')), ticks('1970-01-01T00:00:00Z')), 10000000)}^{date_short_pretty} at {time}|@{outputs('Event_time')}>
<https://portal.azure.com/#view/Microsoft_Azure_Monitoring_Alerts/AlertDetails.ReactView/alertId~/@{encodeUriComponent(coalesce(outputs('Essentials')?['alertId'], ''))}|Open the alert in the Azure portal> | <@{parameters('workbookUrl')}|CheckMate Health workbook>@{if(empty(coalesce(outputs('Criterion')?['linkToFilteredSearchResultsUI'], '')), '', concat(' | <', outputs('Criterion')?['linkToFilteredSearchResultsUI'], '|Query results>'))}@{if(or(equals(outputs('Essentials')?['monitorCondition'], 'Resolved'), empty(coalesce(parameters('alertSteps')?[coalesce(outputs('Essentials')?['alertRule'], '')], ''))), '', concat(decodeUriComponent('%0A'), '*What to do:*', decodeUriComponent('%0A'), parameters('alertSteps')?[coalesce(outputs('Essentials')?['alertRule'], '')]))}'''

var budgetAlertMessage = '''
:moneybag: *Budget alert* *@{outputs('Parse_payload')?['data']?['BudgetName']}*
Spent @{outputs('Parse_payload')?['data']?['SpendingAmount']} @{outputs('Parse_payload')?['data']?['Unit']} of the @{outputs('Parse_payload')?['data']?['Budget']} @{outputs('Parse_payload')?['data']?['Unit']} budget (alert at @{mul(float(coalesce(outputs('Parse_payload')?['data']?['NotificationThresholdAmount'], '0')), 100)}%) since @{outputs('Parse_payload')?['data']?['BudgetStartDate']}.
<@{parameters('resourceGroupUrl')}|Open the resource group in the Azure portal> (Cost Management > Budgets)
*What to do:*
1. On the *Costs* tab of the <@{parameters('workbookUrl')}|CheckMate Health workbook>, check *Cost by service* and *Daily cost by service* for what the money went on and when it started.
2. A jump in Application Insights or Log Analytics usually means a lot of telemetry (for example a long Generate Load run). A jump in App Service or SQL Database usually means a plan or SKU changed, so check the resource group's Deployments and Activity log.
3. Fix the cause, or raise `monthlyBudget` in `infra/main.bicepparam` if the new spend is expected.'''

// Hides each HTTP action's inputs (the Slack webhook URL and GitHub token) from the Logic App's run history, which
// anyone with Reader on the resource group can see, including the alert investigation identity.
var secureInputs = {
  secureData: {
    properties: ['inputs']
  }
}

var investigatingLine =':mag: Claude is investigating and will post what it finds here.'
var commonAlertText = investigationEnabled
  ? '${commonAlertMessage}@{if(equals(outputs(\'Essentials\')?[\'monitorCondition\'], \'Resolved\'), \'\', concat(decodeUriComponent(\'%0A\'), \'${investigatingLine}\'))}'
  : commonAlertMessage
var budgetAlertText = investigationEnabled ? '${budgetAlertMessage}\n${investigatingLine}' : budgetAlertMessage

// The Logic App parameters and actions below are only added when investigations are enabled.
var investigationParameterValues = {
  githubToken: {
    value: alertInvestigationToken
  }
  githubRepository: {
    value: githubRepository
  }
}
var investigationParameterTypes = {
  githubToken: {
    type: 'securestring'
  }
  githubRepository: {
    type: 'string'
  }
}

// Starts .github/workflows/alert-investigation.yml for fired alerts and budget alerts (not resolved ones). It runs
// alongside the Slack branch, so a GitHub problem never holds up the alert message, and posts to Slack if it fails.
var investigationActions = {
  Should_investigate: {
    type: 'If'
    runAfter: {
      Parse_payload: ['Succeeded']
    }
    expression: {
      or: [
        {
          not: {
            equals: [
              '@coalesce(outputs(\'Parse_payload\')?[\'data\']?[\'BudgetName\'], \'\')'
              ''
            ]
          }
        }
        {
          equals: [
            '@outputs(\'Parse_payload\')?[\'data\']?[\'essentials\']?[\'monitorCondition\']'
            'Fired'
          ]
        }
      ]
    }
    actions: {
      Start_Claude_investigation: {
        type: 'Http'
        runAfter: {}
        runtimeConfiguration: secureInputs
        inputs: {
          method: 'POST'
          uri: 'https://api.github.com/repos/@{parameters(\'githubRepository\')}/actions/workflows/alert-investigation.yml/dispatches'
          headers: {
            Accept: 'application/vnd.github+json'
            Authorization: 'Bearer @{parameters(\'githubToken\')}'
            'X-GitHub-Api-Version': '2022-11-28'
          }
          body: {
            ref: 'main'
            inputs: {
              alert: '@{string(outputs(\'Parse_payload\'))}'
            }
          }
        }
      }
      Post_investigation_failure_to_Slack: {
        type: 'Http'
        runAfter: {
          Start_Claude_investigation: ['Failed', 'TimedOut']
        }
        runtimeConfiguration: secureInputs
        inputs: {
          method: 'POST'
          uri: '@parameters(\'slackWebhookUrl\')'
          body: {
            text: ':warning: Claude couldn\'t start investigating this alert: GitHub returned @{outputs(\'Start_Claude_investigation\')?[\'statusCode\']}. Check that the `ALERT_INVESTIGATION_TOKEN` secret hasn\'t expired (see Alert Investigation in the README).'
          }
        }
      }
    }
  }
}

resource slackNotifier 'Microsoft.Logic/workflows@2019-05-01' = if (slackEnabled) {
  name: 'CheckMate-SlackAlerts'
  location: location
  properties: {
    state: 'Enabled'
    parameters: union(investigationEnabled ? investigationParameterValues : {}, {
      slackWebhookUrl: {
        value: slackWebhookUrl
      }
      resourceGroupUrl: {
        value: 'https://portal.azure.com/#@/resource${resourceGroup().id}'
      }
      workbookUrl: {
        value: workbookUrl
      }
      alertSteps: {
        value: toObject(
          items(alertSteps),
          rule => rule.key,
          rule => join(map(rule.value, (step, i) => '${i + 1}. ${step}'), '\n')
        )
      }
      operators: {
        value: {
          GreaterThan: '>'
          GreaterThanOrEqual: '>='
          LessThan: '<'
          LessThanOrEqual: '<='
          Equals: '='
        }
      }
    })
    definition: {
      '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#'
      contentVersion: '1.0.0.0'
      parameters: union(investigationEnabled ? investigationParameterTypes : {}, {
        slackWebhookUrl: {
          type: 'securestring'
        }
        resourceGroupUrl: {
          type: 'string'
        }
        workbookUrl: {
          type: 'string'
        }
        alertSteps: {
          type: 'object'
        }
        operators: {
          type: 'object'
        }
      })
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
      actions: union(investigationEnabled ? investigationActions : {}, {
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
              runtimeConfiguration: secureInputs
              inputs: {
                method: 'POST'
                uri: '@parameters(\'slackWebhookUrl\')'
                body: {
                  text: budgetAlertText
                }
              }
            }
          }
          else: {
            actions: {
              Essentials: {
                type: 'Compose'
                runAfter: {}
                inputs: '@coalesce(outputs(\'Parse_payload\')?[\'data\']?[\'essentials\'], json(\'{}\'))'
              }
              Event_time: {
                type: 'Compose'
                runAfter: {
                  Essentials: ['Succeeded']
                }
                inputs: '@if(equals(outputs(\'Essentials\')?[\'monitorCondition\'], \'Resolved\'), coalesce(outputs(\'Essentials\')?[\'resolvedDateTime\'], outputs(\'Essentials\')?[\'firedDateTime\']), outputs(\'Essentials\')?[\'firedDateTime\'])'
              }
              // The first condition of a metric or log alert, with the measured value and threshold.
              Criterion: {
                type: 'Compose'
                runAfter: {
                  Event_time: ['Succeeded']
                }
                inputs: '@coalesce(outputs(\'Parse_payload\')?[\'data\']?[\'alertContext\']?[\'condition\']?[\'allOf\']?[0], json(\'{}\'))'
              }
              Measured_line: {
                type: 'Compose'
                runAfter: {
                  Criterion: ['Succeeded']
                }
                inputs: measuredLine
              }
              // Resource Health and Service Health alerts carry Azure's own description of the problem.
              Azure_says_line: {
                type: 'Compose'
                runAfter: {
                  Measured_line: ['Succeeded']
                }
                inputs: azureSaysLine
              }
              Post_alert_to_Slack: {
                type: 'Http'
                runAfter: {
                  Azure_says_line: ['Succeeded']
                }
                runtimeConfiguration: secureInputs
                inputs: {
                  method: 'POST'
                  uri: '@parameters(\'slackWebhookUrl\')'
                  body: {
                    text: commonAlertText
                  }
                }
              }
            }
          }
        }
      })
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
    // CI turns it off while a backend deploy has the API paused (.github/scripts/set-health-check.sh).
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
    description: 'The API health availability test failed 3 of its last 4 runs.'
    steps: [
      'On the *Overview* tab of the ${workbookLink}, *Failed health checks* shows the status code or error. ${availabilityLink} has every test result.'
      'Open ${healthEndpointLink} yourself to see whether the API is still down.'
      'A 404 or 503 right after a deployment usually means the infrastructure deployed but the API didn\'t: check the latest of the ${ciRunsLink}.'
      'Check the ${logStreamLink} and the *API startup log* on the *Infrastructure* tab for a crash on start, and ${troubleshootLink} for restarts. If the F1 plan\'s daily CPU quota ran out, the app stays stopped until it resets.'
      'If the app is stuck, restart it from the ${appServiceLink} overview.'
    ]
    severity: 1
    scope: appInsightsId
    namespace: 'microsoft.insights/components'
    metric: 'availabilityResults/availabilityPercentage'
    timeAggregation: 'Average'
    operator: 'LessThan'
    threshold: 50
    // An hour holds 4 runs, so a brief blip of up to 2 failed runs doesn't fire it. Deploy pauses don't count:
    // CI turns the test off while the API is paused.
    windowSize: 'PT1H'
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
    steps: apiServerErrorSteps
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
    steps: [
      'On the *API* tab of the ${workbookLink}, check *SQL calls* and *All outgoing dependencies* for what\'s failing, and *Database errors* and the database *Connections* chart on the *Infrastructure* tab.'
      'A few failures while the database resumes from auto-pause are normal, and the API retries them. If they keep failing, check the ${resourceHealthLinks}.'
      'If the month\'s free SQL vCore-seconds ran out, the database stays paused until next month (see *Free amount remaining* on the *Infrastructure* tab).'
      'Login or permission errors mean the App Service identity lost its database user; see Identities & Permissions in the README.'
    ]
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
    steps: [
      'On the *Frontend* tab of the ${workbookLink}, check *Browser exceptions* for the operation (load, save, delete) that failed and its *Status*.'
      'This alert counts every exception, including expected ones, so check whether one of the ${loadTestRunsLink} was running. If it was and the *Status* column says they\'re expected, close the alert.'
      'Open ${failuresLink} and switch to *Browser* for the stack traces. If it started with a frontend deployment (${ciRunsLink}), revert the change on `main`.'
    ]
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
    steps: [
      'On the *Frontend* tab of the ${workbookLink}, check *Browser calls to the API* for the calls and result codes that failed.'
      'If the *API* tab shows the same failures, follow the steps for *CheckMate API server errors*.'
      'If it doesn\'t, the calls never reached the API: look for CORS errors (the allowed origin is set in `infra/modules/appservice.bicep`), network errors, or the API being down or cold-starting.'
    ]
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
    steps: [
      'On the *Infrastructure* tab of the ${workbookLink}, check *CPU time* for when the CPU was used.'
      'Find what used it: ${performanceLink} shows the busiest operations, and ${loadTestRunsLink} and unusual traffic both add up quickly.'
      'When the quota runs out the app stops until the daily quota resets. If it has to stay up, change `appServicePlanSku` in `infra/main.bicepparam` to a paid plan such as B1 for now.'
    ]
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
    steps: [
      'On the *Infrastructure* tab of the ${workbookLink}, check *Free amount remaining* and *App CPU billed* for when the database was busy.'
      'Look for what keeps it awake: anything calling the API regularly (bots, ${loadTestRunsLink}) stops it auto-pausing. ${performanceLink} shows which operations are called most.'
      'When the free vCore-seconds run out the database pauses until the 1st of next month, and every API call that needs the database fails until then.'
    ]
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
    steps: [
      'Open the frontend to see whether it still loads, and check the ${resourceHealthLinks}.'
      'On the *Infrastructure* tab of the ${workbookLink}, check the storage *Availability %* and *Transactions* charts for which requests failed.'
      'Storage outages are usually on Azure\'s side: check ${azureStatusLink} and wait for the resolved message.'
    ]
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
    name: 'CheckMate SQL storage'
    description: 'The database has used more than 80% of its maximum size.'
    steps: [
      'On the *Infrastructure* tab of the ${workbookLink}, check *Data space used %* for how fast it\'s growing.'
      'Find the biggest tables, and whether something is creating far more data than expected (for example checklists left behind by tests).'
      'Clean up the data. `maxSizeBytes` in `infra/modules/sql.bicep` is already at the free offer\'s 32 GB limit.'
    ]
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

// A log alert rather than the App Service HttpResponseTime metric, which also counts Kudu deployment calls: at
// CheckMate's traffic a deployment's few slow publish calls pushed the 30 minute average over the threshold. App
// Insights only sees the app's own requests, and needing at least 10 of them keeps a cold start from alerting alone.
resource slowApi 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: slowApiName
  location: location
  properties: {
    displayName: slowApiName
    description: 'The API\'s average response time was over 5 seconds across at least 10 requests in 30 minutes.'
    severity: 3
    enabled: true
    scopes: [workspaceId]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT30M'
    autoMitigate: true
    criteria: {
      allOf: [
        {
          query: 'AppRequests\n| where AppRoleName != "${frontendRoleName}" and Url !endswith "/robots933456.txt"\n| summarize Requests = count(), AverageMs = avg(DurationMs)\n| where Requests >= 10 and AverageMs > 5000'
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

// Needs at least 5 page loads so one slow phone on bad wifi doesn't alert.
resource slowPageLoads 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: slowPageLoadsName
  location: location
  properties: {
    displayName: slowPageLoadsName
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
  name: failureAnomaliesName
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
  name: resourceHealthName
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
  name: serviceHealthName
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
