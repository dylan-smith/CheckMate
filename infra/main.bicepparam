using './main.bicep'

// Production values for the CheckMate resource group. Deploying with these values into an empty resource
// group provisions the whole environment; redeploying updates the existing resources in place, so renaming
// anything here creates a new resource instead of renaming the old one.
param location = 'westus2'
param storageLocation = 'westus'
param appInsightsLocation = 'westus'

// App Service (backend API)
param appServiceName = 'CheckMate'
param appServicePlanName = 'CheckMate-Plan'
param appServicePlanSku = 'F1'

// Storage Account (frontend static website; 'checkmate' is taken globally)
param storageAccountName = 'checkmateweb'

// Database backups (BACPAC exports taken by CI before migrations, in the db-backups container)
param backupRetentionDays = 30

// SQL Server and Database (Entra-only auth; 'checkmate' is taken globally)
param sqlServerName = 'checkmate-sql'
param sqlDatabaseName = 'CheckMate'
param sqlEntraAdminLogin = 'Dylan@devopsdylan.com'
param sqlEntraAdminObjectId = '148c80fc-4e2d-4fec-9539-aa1a23b344ab'
param sqlEntraAdminPrincipalType = 'User'

// Passed in from the AZURE_SQL_CONNECTION_STRING secret; never commit it.
param sqlConnectionString = readEnvironmentVariable('AZURE_SQL_CONNECTION_STRING')

// Monitoring
param logAnalyticsWorkspaceName = 'CheckMate'
param appInsightsName = 'CheckMate'

// Alerts (email + Azure mobile app push; Slack when the SLACK_WEBHOOK_URL secret is set)
param alertEmail = 'Dylan@devopsdylan.com'
param slackWebhookUrl = readEnvironmentVariable('SLACK_WEBHOOK_URL', '')
// Claude investigates fired alerts when ALERT_INVESTIGATION_TOKEN is set too (.github/workflows/alert-investigation.yml)
param alertInvestigationToken = readEnvironmentVariable('ALERT_INVESTIGATION_TOKEN', '')
param githubRepository = 'dylan-smith/CheckMate'
param monthlyBudget = 10
// The month the budget was first deployed. Azure won't change it on an existing budget, so a new environment should
// use the first of the month it's created in.
param budgetStartDate = '2026-10-01'
