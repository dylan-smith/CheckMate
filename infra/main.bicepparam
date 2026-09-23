using './main.bicep'

// Production values for the Checkmate2 resource group. Names and regions must match the existing
// resources exactly, otherwise a deployment creates new resources instead of updating them.
param location = 'westus2'
param storageLocation = 'westus'
param appInsightsLocation = 'westus'

// App Service (backend API)
param appServiceName = 'CheckMate2'
param appServicePlanName = 'CheckMate2-API'
param appServicePlanSku = 'F1'

// Storage Account (frontend static website)
param storageAccountName = 'checkmate2'

// SQL Server and Database (Entra-only auth; the existing server's admin is left unchanged)
param sqlServerName = 'checkmate2'
param sqlDatabaseName = 'CheckMate2'

// Passed in from the AZURE_SQL_CONNECTION_STRING secret; never commit it.
param sqlConnectionString = readEnvironmentVariable('AZURE_SQL_CONNECTION_STRING')

// Monitoring
param logAnalyticsWorkspaceName = 'Checkmate2'
param appInsightsName = 'Checkmate2'
