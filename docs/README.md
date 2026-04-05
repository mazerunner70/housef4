# Housef4 Documentation

Welcome to the `housef4` monorepo.

## Structure

* `/frontend` - React + Vite SPA
* `/backend` - Node.js + TS Lambda Handlers
* `/db` - Database repository abstraction layer (DynamoDB wrapper)
* `/infrastructure` - Terraform definitions for AWS resources

## Setup

1. Run `pnpm install` in the root directory.
2. Ensure you have the `AWS_REGION` and AWS credentials configured.
3. Replace the `YOUR_TERRAFORM_STATE_BUCKET_NAME` in `infrastructure/backend.tf` to your S3 bucket.
