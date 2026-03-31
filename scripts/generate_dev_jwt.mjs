import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const [, , secretOrSubArg, maybeSubArg, maybeTierArg, maybeBudgetArg] = process.argv;
const repoRoot = resolve(import.meta.dirname, "..");
const fileSecret = readJwtSecretFromCandidates([
  resolve(repoRoot, "workers/gateway/.dev.vars"),
  resolve(process.cwd(), "workers/gateway/.dev.vars"),
  resolve(process.cwd(), ".dev.vars")
]);
const explicitSecretProvided = Boolean(maybeBudgetArg);
const secret = explicitSecretProvided ? secretOrSubArg : fileSecret;
const subject = explicitSecretProvided ? maybeSubArg : secretOrSubArg ?? "demo-user";
const tier = explicitSecretProvided ? maybeTierArg : maybeSubArg ?? "standard";
const budget = explicitSecretProvided ? maybeBudgetArg : maybeTierArg ?? "500";

if (!secret) {
  console.error("JWT secret not found.");
  console.error("Run: npm run setup:local-auth");
  console.error("Or pass the secret explicitly: npm run token:dev -- <secret> [sub] [tier] [budget]");
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
  tenantId: "demo-tenant",
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

function readJwtSecretFromCandidates(paths) {
  for (const path of paths) {
    if (!existsSync(path)) {
      continue;
    }

    const line = readFileSync(path, "utf8")
      .split(/\r?\n/)
      .find((entry) => entry.startsWith("JWT_SECRET="));

    if (line) {
      return line.slice("JWT_SECRET=".length);
    }
  }

  return undefined;
}
