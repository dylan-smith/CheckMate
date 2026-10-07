// A pull request's preview environment: a web app, a serverless database and a static-website storage account
// of its own, on an App Service plan and SQL server shared by every preview. The deploy-preview CI job deploys
// this template on each push to a PR, and preview-cleanup.yml deletes the PR's resources when it closes. The
// shared resources are declared here too, so the first deployment creates them and later ones leave them as
// they are.
//
// The resources mirror the production modules (modules/appservice.bicep, modules/sql.bicep and
// modules/storage.bicep) without their monitoring, alerts or backups, so keep their settings in sync when
// changing a module. Nothing here touches production.
targetScope = 'resourceGroup'

@description('Number of the pull request this preview is for. Names every per-PR resource.')
@minValue(1)
// Keeps the storage account name within its 24-character limit.
@maxValue(9999999)
param prNumber int

@description('Azure region for resources.')
param location string = resourceGroup().location

@description('Name of the App Service Plan shared by every preview.')
param appServicePlanName string

@description('SKU of the shared App Service Plan.')
param appServicePlanSku string

@description('Name of the Azure SQL Server shared by every preview.')
param sqlServerName string

@description('Entra ID admin login of the shared SQL Server: the preview deployment identity, which runs the migrations and creates each web app\'s database user.')
param sqlEntraAdminLogin string

@description('Object ID of the preview deployment identity.')
param sqlEntraAdminObjectId string

@description('Use the Azure SQL free offer for the database. The offer covers a limited number of databases per subscription, and can\'t be turned on for an existing database.')
param useFreeLimit bool = true

var appServiceName = 'checkmate-pr-${prNumber}'
var sqlDatabaseName = 'CheckMate-pr-${prNumber}'
// Storage account names are lowercase letters and digits only.
var storageAccountName = 'checkmatepr${prNumber}'

// Lets the cleanup workflow find a PR's resources.
var prTags = {
  'pr-number': string(prNumber)
}

// Free and Shared plans don't support Always On.
var isFreeOrShared = startsWith(appServicePlanSku, 'F') || startsWith(appServicePlanSku, 'D')

// ---- Shared by every preview ----

resource appServicePlan 'Microsoft.Web/serverfarms@2024-11-01' = {
  name: appServicePlanName
  location: location
  kind: 'linux'
  sku: {
    name: appServicePlanSku
  }
  properties: {
    // Marks the plan as Linux; the OS can't be changed on an existing plan.
    reserved: true
  }
}

// Entra-only authentication, with the deployment identity as admin so it can reach every preview database
// without a database user of its own.
resource sqlServer 'Microsoft.Sql/servers@2023-08-01' = {
  name: sqlServerName
  location: location
  properties: {
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    administrators: {
      administratorType: 'ActiveDirectory'
      azureADOnlyAuthentication: true
      login: sqlEntraAdminLogin
      sid: sqlEntraAdminObjectId
      tenantId: tenant().tenantId
      principalType: 'Application'
    }
  }
}

// GitHub-hosted runners run in Azure, so this lets the migrations reach the server.
resource allowAzureServices 'Microsoft.Sql/servers/firewallRules@2023-08-01' = {
  parent: sqlServer
  name: 'AllowAllWindowsAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// ---- This pull request's resources ----

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01' = {
  parent: sqlServer
  name: sqlDatabaseName
  location: location
  tags: prTags
  sku: {
    name: 'GP_S_Gen5'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: 2
  }
  // freeLimitExhaustionBehavior is only valid with the free offer, so it's omitted (not sent as null) otherwise.
  properties: union(
    {
      collation: 'SQL_Latin1_General_CP1_CI_AS'
      maxSizeBytes: 34359738368
      minCapacity: json('0.5')
      autoPauseDelay: 60
      zoneRedundant: false
      requestedBackupStorageRedundancy: 'Local'
      useFreeLimit: useFreeLimit
    },
    useFreeLimit ? { freeLimitExhaustionBehavior: 'AutoPause' } : {}
  )
}

// The static website itself ($web container, index/404 documents) is a data-plane setting that ARM
// can't manage; CI enables it with `az storage blob service-properties update --static-website`.
resource storageAccount 'Microsoft.Storage/storageAccounts@2025-01-01' = {
  name: storageAccountName
  location: location
  tags: prTags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: true
    allowSharedKeyAccess: true
    allowCrossTenantReplication: false
  }
}

resource appService 'Microsoft.Web/sites@2024-11-01' = {
  name: appServiceName
  location: location
  kind: 'app,linux'
  tags: prTags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    autoGeneratedDomainNameLabelScope: 'TenantReuse'
    siteConfig: {
      linuxFxVersion: 'DOTNETCORE|10.0'
      alwaysOn: !isFreeOrShared
      minTlsVersion: '1.2'
      ftpsState: 'FtpsOnly'
    }
  }
}

// This replaces the app's entire settings collection, so every setting the app needs must be declared here.
// There's no Application Insights for previews; the API logs that telemetry is off and carries on.
resource appSettings 'Microsoft.Web/sites/config@2024-11-01' = {
  parent: appService
  name: 'appsettings'
  properties: {
    // The web app connects as its own managed identity; CI creates the database user for it.
    ConnectionStrings__CheckMate: 'Server=tcp:${sqlServer.properties.fullyQualifiedDomainName},1433;Initial Catalog=${sqlDatabase.name};Authentication=Active Directory Managed Identity;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;'
    // The browser sends the origin without a trailing slash.
    Cors__AllowedOrigins__0: replace(storageAccount.properties.primaryEndpoints.web, '.net/', '.net')
    WEBSITE_ENABLE_SYNC_UPDATE_SITE: 'true'
  }
}

@description('Resource ID of the App Service.')
output appServiceId string = appService.id

@description('Default HTTPS URL of the App Service.')
output appServiceUrl string = 'https://${appService.properties.defaultHostName}'

@description('Principal ID of the App Service system-assigned managed identity.')
output appServicePrincipalId string = appService.identity.principalId

@description('Fully qualified domain name of the SQL Server.')
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName

@description('Name of the SQL Database.')
output sqlDatabaseName string = sqlDatabase.name

@description('Name of the Storage Account.')
output storageAccountName string = storageAccount.name

@description('Primary web endpoint for the static website.')
output frontendWebEndpoint string = storageAccount.properties.primaryEndpoints.web
