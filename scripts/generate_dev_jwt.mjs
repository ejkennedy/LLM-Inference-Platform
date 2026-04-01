import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const repoRoot = resolve(import.meta.dirname, "..");
const vars = readDevVarsFromCandidates([
  resolve(repoRoot, "workers/gateway/.dev.vars"),
  resolve(process.cwd(), "workers/gateway/.dev.vars"),
  resolve(process.cwd(), ".dev.vars")
]);
const explicitSecretProvided = args.length >= 4;
const secret = explicitSecretProvided ? args[0] : vars.JWT_SECRET;
const baseIndex = explicitSecretProvided ? 1 : 0;
const subject = args[baseIndex] ?? "demo-user";
const tier = args[baseIndex + 1] ?? "standard";
const budget = args[baseIndex + 2] ?? "500";
const role = args[baseIndex + 3] ?? "user";
const scopes = args[baseIndex + 4] ?? (role === "admin" ? "billing:read" : "chat:write");

if (!secret) {
  console.error("JWT secret not found.");
  console.error("Run: npm run setup:local-auth");
  console.error("Or pass the secret explicitly: npm run token:dev -- <secret> [sub] [tier] [budget] [role] [scopes]");
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const header = {
  alg: "HS256",
  typ: "JWT"
};
const payload = {
  sub: subject,
  tier,
  budgetLimitCents: Number(budget),
  tenantId: vars.TENANT_ID ?? "demo-tenant",
  role,
  scopes: scopes.split(",").map((value) => value.trim()).filter(Boolean),
  iss: vars.JWT_ISSUER,
  aud: vars.JWT_AUDIENCE ? vars.JWT_AUDIENCE.split(",").map((value) => value.trim()) : undefined,
  iat: now,
  exp: now + 60 * 60
};

const encodedHeader = encodeBase64Url(JSON.stringify(header));
const encodedPayload = encodeBase64Url(JSON.stringify(payload));
const signingInput = `${encodedHeader}.${encodedPayload}`;
const signature = crypto
  .createHmac("sha256", secret)
  .update(signingInput)
  .digest("base64url");

process.stdout.write(`${signingInput}.${signature}\n`);

function encodeBase64Url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function readDevVarsFromCandidates(paths) {
  for (const path of paths) {
    if (!existsSync(path)) {
      continue;
    }

    return Object.fromEntries(
      readFileSync(path, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((entry) => {
          const separator = entry.indexOf("=");
          return [entry.slice(0, separator), entry.slice(separator + 1)];
        })
    );
  }

  return {};
}
