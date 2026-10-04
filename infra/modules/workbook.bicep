@description('Azure region for the workbook.')
param location string

@description('Resource ID of the Application Insights component.')
param appInsightsId string

@description('Resource ID of the Log Analytics Workspace.')
param workspaceId string

@description('Resource ID of the App Service (backend API).')
param appServiceId string

@description('Resource ID of the App Service Plan.')
param appServicePlanId string

@description('Resource ID of the SQL Database.')
param sqlDatabaseId string

@description('Resource ID of the frontend Storage Account.')
param storageAccountId string

@description('Default HTTPS URL of the backend App Service, without a trailing slash.')
param apiUrl string

@description('Primary web endpoint for the frontend static website.')
param frontendUrl string

// The workbook JSON is exported from the portal's Advanced editor with each resource ID and site URL
// swapped for a placeholder token, so it can be edited in the portal and pasted back into the repo.
var serializedData = reduce(
  items({
    __APP_INSIGHTS_ID__: appInsightsId
    __WORKSPACE_ID__: workspaceId
    __APP_SERVICE_ID__: appServiceId
    __APP_SERVICE_PLAN_ID__: appServicePlanId
    __SQL_DATABASE_ID__: sqlDatabaseId
    __STORAGE_ACCOUNT_ID__: storageAccountId
    __RESOURCE_GROUP_ID__: resourceGroup().id
    __API_URL__: apiUrl
    __FRONTEND_URL__: frontendUrl
  }),
  loadTextContent('../workbooks/health.workbook.json'),
  (json, token) => replace(json, token.key, token.value)
)

resource workbook 'Microsoft.Insights/workbooks@2023-06-01' = {
  // Workbook names must be GUIDs; a deterministic one keeps redeploys updating the same workbook.
  name: guid(resourceGroup().id, 'checkmate-health-workbook')
  location: location
  kind: 'shared'
  properties: {
    displayName: 'CheckMate Health'
    category: 'workbook'
    // Lowercase so the portal lists it under Application Insights → Workbooks.
    sourceId: toLower(appInsightsId)
    serializedData: serializedData
  }
}

@description('Resource ID of the health workbook.')
output workbookId string = workbook.id
