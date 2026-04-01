# Terraform Scaffold

This directory manages the account-level resources that are painful to recreate manually:

- `MODEL_CATALOGUE` KV namespace
- `PROMPT_REGISTRY` KV namespace
- environment-specific worker names and derived gateway URL outputs

The Worker script deployments still happen through `wrangler deploy`, which remains the cleanest path for bundling and service bindings in this repo.

## Usage

1. Install Terraform locally.
2. Export your Cloudflare API token:

```bash
export TF_VAR_cloudflare_api_token="<cloudflare-api-token>"
```

3. Copy the environment example file and fill in the values:

```bash
cp environments/staging.tfvars.example environments/staging.tfvars
cp environments/production.tfvars.example environments/production.tfvars
```

4. Apply an environment:

```bash
terraform -chdir=infra/terraform init
terraform -chdir=infra/terraform apply -var-file=environments/staging.tfvars
```

5. Copy the output namespace IDs into the matching Wrangler config if they are not already present.

## Existing environments

If the KV namespaces already exist, import them before the first apply:

```bash
terraform -chdir=infra/terraform import -var-file=environments/staging.tfvars \
  cloudflare_workers_kv_namespace.model_catalogue "<account-id>/<namespace-id>"

terraform -chdir=infra/terraform import -var-file=environments/staging.tfvars \
  cloudflare_workers_kv_namespace.prompt_registry "<account-id>/<namespace-id>"
```

Run the import separately for each environment state you manage.
