terraform {
  backend "s3" {
    bucket         = "housef4-tfstate" # TODO: replace with your actual bucket name
    key            = "housef4/terraform.tfstate"
    region         = "eu-west-1"
    encrypt        = true
    dynamodb_table = "housef4-tfstate-lock" # Backend setup for locking with DynamoDB
  }
}
