terraform {
  backend "s3" {
    bucket       = "housef4-tfstate" 
    key          = "housef4/terraform.tfstate"
    region       = "eu-west-2"
    encrypt      = true
    use_lockfile = true
    # Locking uses a *.tflock object in this bucket (requires bucket versioning).
    # If init fails, enable versioning:
    #   aws s3api put-bucket-versioning --bucket housef4-tfstate \
    #     --versioning-configuration Status=Enabled --region eu-west-2
    # After changing backend settings: terraform init -reconfigure
  }
}
