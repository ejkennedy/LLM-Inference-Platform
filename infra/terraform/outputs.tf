output "worker_names" {
  description = "Worker names for the selected environment."
  value       = local.worker_names
}

output "gateway_url" {
  description = "workers.dev URL for the gateway worker."
  value       = "https://${local.worker_names.gateway}.${var.workers_subdomain}.workers.dev"
}

output "ai_gateway_id" {
  description = "Configured AI Gateway ID."
  value       = var.ai_gateway_id
}

output "analytics_dataset" {
  description = "Configured Analytics Engine dataset name."
  value       = var.analytics_dataset
}

output "kv_namespace_ids" {
  description = "KV namespace IDs to bind in Wrangler."
  value = {
    model_catalogue = cloudflare_workers_kv_namespace.model_catalogue.id
    prompt_registry = cloudflare_workers_kv_namespace.prompt_registry.id
  }
}
