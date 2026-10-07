using './preview.bicep'

// Values for a pull request's preview environment in the CheckMate-Preview resource group (the resources every
// preview shares are in preview-shared.bicepparam). The deploy-preview CI job sets PREVIEW_PR_NUMBER and
// PREVIEW_DATABASE_TAGS; to run the template by hand, set PREVIEW_PR_NUMBER to the PR's number first.
param location = 'westus2'
param prNumber = int(readEnvironmentVariable('PREVIEW_PR_NUMBER'))

// The shared resources, deployed by preview-shared.bicep
param appServicePlanName = 'CheckMate-Preview-Plan'
param sqlServerName = 'checkmate-preview-sql'

// The free offer covers 10 databases per subscription, one of which is production's. Turn this off if a
// deployment fails because they're used up (an existing database keeps the setting it was created with).
param useFreeLimit = true

// The database's current tags, as JSON, so the deployment keeps them (see the parameter in preview.bicep)
param existingDatabaseTags = json(readEnvironmentVariable('PREVIEW_DATABASE_TAGS', '{}'))
