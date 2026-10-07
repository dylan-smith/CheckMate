using './preview.bicep'

// Values for the CheckMate-Preview resource group, which holds every pull request's preview environment. The
// deploy-preview CI job sets PREVIEW_PR_NUMBER; to run the template by hand, set it to the PR's number first.
param location = 'westus2'
param prNumber = int(readEnvironmentVariable('PREVIEW_PR_NUMBER'))

// Shared by every preview
param appServicePlanName = 'CheckMate-Preview-Plan'
param appServicePlanSku = 'F1'
param sqlServerName = 'checkmate-preview-sql'

// The checkmate-preview-deploy managed identity (see README, Identities & Permissions)
param sqlEntraAdminLogin = 'checkmate-preview-deploy'
param sqlEntraAdminObjectId = '00000000-0000-0000-0000-000000000000'

// The free offer covers 10 databases per subscription, one of which is production's. Turn this off if a
// deployment fails because they're used up (an existing database keeps the setting it was created with).
param useFreeLimit = true
