using './preview-shared.bicep'

// Values for the resources shared by every preview environment in the CheckMate-Preview resource group. CI
// deploys these from the PR's base branch, so a change here reaches previews once it's merged.
param location = 'westus2'

param appServicePlanName = 'CheckMate-Preview-Plan'
param appServicePlanSku = 'F1'
param sqlServerName = 'checkmate-preview-sql'

// The checkmate-preview-deploy managed identity (see README, Identities & Permissions)
param sqlEntraAdminLogin = 'checkmate-preview-deploy'
param sqlEntraAdminObjectId = '48ab6f58-454d-4a88-870f-18d071bf38ff'
