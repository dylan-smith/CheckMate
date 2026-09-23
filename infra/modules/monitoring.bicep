@description('Azure region for the Log Analytics Workspace.')
param workspaceLocation string

@description('Azure region for the Application Insights component.')
param appInsightsLocation string

@description('Name of the Log Analytics Workspace.')
param workspaceName string

@description('Name of the Application Insights component.')
param appInsightsName string

resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2025-02-01' = {
  name: workspaceName
  location: workspaceLocation
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: appInsightsLocation
  kind: 'web'
  properties: {
    Application_Type: 'web'
    Flow_Type: 'Redfield'
    Request_Source: 'IbizaAIExtension'
    RetentionInDays: 90
    WorkspaceResourceId: logAnalyticsWorkspace.id
    IngestionMode: 'LogAnalytics'
  }
}

@description('Resource ID of the Log Analytics Workspace.')
output workspaceId string = logAnalyticsWorkspace.id

@description('Resource ID of the Application Insights component.')
output appInsightsId string = appInsights.id

@description('Application Insights connection string.')
output appInsightsConnectionString string = appInsights.properties.ConnectionString

@description('Application Insights instrumentation key.')
output appInsightsInstrumentationKey string = appInsights.properties.InstrumentationKey
