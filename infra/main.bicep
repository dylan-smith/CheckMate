targetScope = 'resourceGroup'

@description('Default Azure region for resources. Defaults to the resource group location.')
param location string = resourceGroup().location

@description('Azure region for the frontend Storage Account.')
param storageLocation string = location

@description('Azure region for the Application Insights component.')
param appInsightsLocation string = location

@description('Name of the Azure App Service (backend API).')
param appServiceName string

@description('Name of the Azure App Service Plan.')
param appServicePlanName string

@description('SKU for the App Service Plan (e.g. F1, B1, S1, P1v3).')
param appServicePlanSku string = 'F1'

@description('Name of the Azure Storage Account for the frontend static website (globally unique, lowercase, 3-24 characters).')
@minLength(3)
@maxLength(24)
param storageAccountName string

@description('Name of the Azure SQL Server.')
param sqlServerName string

@description('Name of the Azure SQL Database.')
param sqlDatabaseName string

@description('Entra ID admin login for the SQL Server. Only needed when creating the server.')
param sqlEntraAdminLogin string = ''

@description('Object ID of the SQL Server Entra ID admin. Only needed when creating the server.')
param sqlEntraAdminObjectId string = ''

@description('Principal type of the SQL Server Entra ID admin (User, Group or Application).')
@allowed(['User', 'Group', 'Application'])
param sqlEntraAdminPrincipalType string = 'User'

@description('SQL connection string used by the API at runtime.')
@secure()
param sqlConnectionString string

@description('Days to keep database backups before they are deleted automatically.')
@minValue(1)
param backupRetentionDays int = 30

@description('Name of the Log Analytics Workspace.')
param logAnalyticsWorkspaceName string

@description('Name of the Application Insights component.')
param appInsightsName string

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    workspaceLocation: location
    appInsightsLocation: appInsightsLocation
    workspaceName: logAnalyticsWorkspaceName
    appInsightsName: appInsightsName
  }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    location: storageLocation
    storageAccountName: storageAccountName
    backupRetentionDays: backupRetentionDays
  }
}

module sql 'modules/sql.bicep' = {
  name: 'sql'
  params: {
    location: location
    serverName: sqlServerName
    databaseName: sqlDatabaseName
    entraAdminLogin: sqlEntraAdminLogin
    entraAdminObjectId: sqlEntraAdminObjectId
    entraAdminPrincipalType: sqlEntraAdminPrincipalType
  }
}

module appService 'modules/appservice.bicep' = {
  name: 'appservice'
  params: {
    location: location
    planName: appServicePlanName
    appName: appServiceName
    planSku: appServicePlanSku
    appInsightsId: monitoring.outputs.appInsightsId
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    appInsightsInstrumentationKey: monitoring.outputs.appInsightsInstrumentationKey
    logAnalyticsWorkspaceId: monitoring.outputs.workspaceId
    sqlConnectionString: sqlConnectionString
    // The browser sends the origin without a trailing slash.
    corsAllowedOrigin: replace(storage.outputs.primaryWebEndpoint, '.net/', '.net')
  }
}

@description('Default HTTPS URL of the backend App Service.')
output appServiceUrl string = appService.outputs.appServiceUrl

@description('Primary web endpoint for the frontend static website.')
output frontendWebEndpoint string = storage.outputs.primaryWebEndpoint

@description('Fully qualified domain name of the SQL Server.')
output sqlServerFqdn string = sql.outputs.sqlServerFqdn
