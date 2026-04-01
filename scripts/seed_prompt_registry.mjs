import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const environment = process.argv[2];
const namespaceId = process.env.PROMPT_REGISTRY_NAMESPACE_ID;

if (!environment || !["staging", "production"].includes(environment)) {
  console.error("Usage: npm run seed:prompts -- <staging|production>");
  process.exit(1);
}

if (!namespaceId) {
  console.error("Missing PROMPT_REGISTRY_NAMESPACE_ID environment variable");
  process.exit(1);
}

const repoRoot = resolve(import.meta.dirname, "..");
const seedPath = resolve(repoRoot, "workers/gateway/prompt-registry.seed.json");
const value = readFileSync(seedPath, "utf8");
const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID;

if (!apiToken || !accountId) {
  console.error("Missing Cloudflare credentials in CLOUDFLARE_API_TOKEN/CF_API_TOKEN and CLOUDFLARE_ACCOUNT_ID/CF_ACCOUNT_ID");
  process.exit(1);
}

const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/prompts`,
  {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json"
    },
    body: value
  }
);

if (!response.ok) {
  console.error(await response.text());
  process.exit(1);
}

console.log(`Seeded prompt registry for ${environment}`);
