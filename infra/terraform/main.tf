locals {
  worker_names = {
    router        = var.environment == "production" ? "llm-router" : "llm-router-staging"
    gateway       = var.environment == "production" ? "llm-gateway" : "llm-gateway-staging"
    observability = var.environment == "production" ? "llm-observability" : "llm-observability-staging"
  }

  kv_titles = {
    model_catalogue = "model-catalogue-${var.environment}"
    prompt_registry = "prompt-registry-${var.environment}"
  }
}

resource "cloudflare_workers_kv_namespace" "model_catalogue" {
  account_id = var.account_id
  title      = local.kv_titles.model_catalogue
}

resource "cloudflare_workers_kv_namespace" "prompt_registry" {
  account_id = var.account_id
  title      = local.kv_titles.prompt_registry
}
