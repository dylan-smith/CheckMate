@description('Azure region for resources.')
param location string

@description('Name of the Azure Storage Account (must be globally unique, lowercase, 3-24 characters).')
@minLength(3)
@maxLength(24)
param storageAccountName string

// The static website itself ($web container, index/404 documents) is a data-plane setting that ARM
// can't manage; CI enables it with `az storage blob service-properties update --static-website`.
resource storageAccount 'Microsoft.Storage/storageAccounts@2025-01-01' = {
  name: storageAccountName
  location: location
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

@description('Primary web endpoint for the static website.')
output primaryWebEndpoint string = storageAccount.properties.primaryEndpoints.web
