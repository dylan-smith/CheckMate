// The resources every pull request's preview environment shares: an App Service plan and a SQL server. The
// deploy-preview CI job deploys this template from the PR's base branch (not the PR) before deploying the PR's
// own resources (preview.bicep), so every preview shares one configuration and a PR can't change it for the
// others, or revert a newer one from its older checkout. A change here reaches previews once it's merged.
//
// The resources mirror the production modules (modules/appservice.bicep and modules/sql.bicep) without their
// monitoring, so keep their settings in sync when changing a module. Nothing here touches production.
targetScope = 'resourceGroup'

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
