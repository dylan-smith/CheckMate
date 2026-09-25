@description('Azure region for resources.')
param location string

@description('Name of the Azure Storage Account (must be globally unique, lowercase, 3-24 characters).')
@minLength(3)
@maxLength(24)
param storageAccountName string

@description('Days to keep database backups in the db-backups container before they are deleted automatically.')
@minValue(1)
param backupRetentionDays int = 30

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

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2025-01-01' = {
  parent: storageAccount
  name: 'default'
}

// Private container for the BACPAC exports CI takes before running database migrations.
resource backupContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-01-01' = {
  parent: blobService
  name: 'db-backups'
  properties: {
    publicAccess: 'None'
  }
}

// Deletes old backups so the container doesn't grow indefinitely.
resource lifecyclePolicy 'Microsoft.Storage/storageAccounts/managementPolicies@2025-01-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'delete-old-db-backups'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: ['blockBlob']
              prefixMatch: ['${backupContainer.name}/']
            }
            actions: {
              baseBlob: {
                delete: {
                  daysAfterCreationGreaterThan: backupRetentionDays
                }
              }
            }
          }
        }
      ]
    }
  }
}

@description('Primary web endpoint for the static website.')
output primaryWebEndpoint string = storageAccount.properties.primaryEndpoints.web
