@description('Azure region for resources.')
param location string

@description('Name of the Azure SQL Server.')
param serverName string

@description('Name of the Azure SQL Database.')
param databaseName string

@description('Entra ID admin login (UPN or group name). Only applied when the server is first created; leave empty to keep the existing admin.')
param entraAdminLogin string = ''

@description('Object ID of the Entra ID admin. Required when entraAdminLogin is set.')
param entraAdminObjectId string = ''

@description('Principal type of the Entra ID admin.')
@allowed(['User', 'Group', 'Application'])
param entraAdminPrincipalType string = 'User'

@description('Maximum database size in bytes. 2 GB is the most the Basic tier allows.')
param maxSizeBytes int = 2147483648

@description('Resource ID of the Log Analytics Workspace for database diagnostic logs.')
param logAnalyticsWorkspaceId string

resource sqlServer 'Microsoft.Sql/servers@2023-08-01' = {
  name: serverName
  location: location
  // Entra-only authentication: no SQL admin password to manage. The administrators property is
  // omitted entirely (not sent as null) when no admin is supplied, so the existing admin is untouched.
  properties: union(
    {
      minimalTlsVersion: '1.2'
      publicNetworkAccess: 'Enabled'
    },
    empty(entraAdminLogin)
      ? {}
      : {
          administrators: {
            administratorType: 'ActiveDirectory'
            azureADOnlyAuthentication: true
            login: entraAdminLogin
            sid: entraAdminObjectId
            tenantId: tenant().tenantId
            principalType: entraAdminPrincipalType
          }
        }
  )
}

resource allowAzureServices 'Microsoft.Sql/servers/firewallRules@2023-08-01' = {
  parent: sqlServer
  name: 'AllowAllWindowsAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01' = {
  parent: sqlServer
  name: databaseName
  location: location
  // Basic (5 DTU) is the cheapest tier that never pauses, so the first request after a quiet spell isn't
  // held up by a serverless resume. PR previews stay on the serverless free offer (preview.bicep).
  sku: {
    name: 'Basic'
    tier: 'Basic'
    capacity: 5
  }
  properties: {
    collation: 'SQL_Latin1_General_CP1_CI_AS'
    maxSizeBytes: maxSizeBytes
    zoneRedundant: false
    requestedBackupStorageRedundancy: 'Local'
  }
}

// Only the low-volume health categories; Query Store and wait statistics are left off to keep
// ingestion cost down. Azure SQL writes these to the AzureDiagnostics table.
resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: sqlDatabase
  name: 'logs-to-workspace'
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    logs: [
      for category in [
        'Errors'
        'Timeouts'
        'Blocks'
        'Deadlocks'
        'AutomaticTuning'
      ]: {
        category: category
        enabled: true
      }
    ]
  }
}

@description('Fully qualified domain name of the SQL Server.')
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName

@description('Resource ID of the SQL Database.')
output sqlDatabaseId string = sqlDatabase.id
