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

@description('Serverless vCore maximum capacity.')
param maxCapacity int = 2

@description('Serverless minimum capacity (vCores).')
param minCapacity string = '0.5'

@description('Minutes of inactivity before the serverless database auto-pauses.')
param autoPauseDelay int = 60

@description('Maximum database size in bytes.')
param maxSizeBytes int = 34359738368

@description('Use the Azure SQL free offer (monthly free vCore-seconds and storage).')
param useFreeLimit bool = true

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
  sku: {
    name: 'GP_S_Gen5'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: maxCapacity
  }
  // freeLimitExhaustionBehavior is only valid with the free offer, so it's omitted (not sent as null) otherwise.
  properties: union(
    {
      collation: 'SQL_Latin1_General_CP1_CI_AS'
      maxSizeBytes: maxSizeBytes
      minCapacity: json(minCapacity)
      autoPauseDelay: autoPauseDelay
      zoneRedundant: false
      requestedBackupStorageRedundancy: 'Local'
      useFreeLimit: useFreeLimit
    },
    useFreeLimit ? { freeLimitExhaustionBehavior: 'AutoPause' } : {}
  )
}

@description('Fully qualified domain name of the SQL Server.')
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
