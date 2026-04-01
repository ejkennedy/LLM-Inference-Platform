variable "cloudflare_api_token" {
  description = "Cloudflare API token used by Terraform."
  type        = string
  sensitive   = true
}

variable "account_id" {
  description = "Cloudflare account ID."
  type        = string
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "workers_subdomain" {
  description = "workers.dev subdomain for generated gateway URLs."
  type        = string
}

variable "ai_gateway_id" {
  description = "AI Gateway ID for the selected environment."
  type        = string
}

variable "analytics_dataset" {
  description = "Analytics Engine dataset name."
  type        = string
  default     = "llm_requests"
}
