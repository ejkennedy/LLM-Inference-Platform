import crypto from "node:crypto";

const [, , secretArg, subjectArg = "demo-user", tierArg = "standard", budgetArg = "500"] = process.argv;

if (!secretArg) {
  console.error("Usage: node scripts/generate_dev_jwt.mjs <secret> [sub] [tier] [budgetLimitCents]");
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const header = {
  alg: "HS256",
  typ: "JWT"
};
const payload = {
  sub: subjectArg,
  tier: tierArg,
  budgetLimitCents: Number(budgetArg),
  tenantId: "demo-tenant",
  iat: now,
  exp: now + 60 * 60
};

const encodedHeader = encodeBase64Url(JSON.stringify(header));
const encodedPayload = encodeBase64Url(JSON.stringify(payload));
const signingInput = `${encodedHeader}.${encodedPayload}`;
const signature = crypto
  .createHmac("sha256", secretArg)
  .update(signingInput)
  .digest("base64url");

process.stdout.write(`${signingInput}.${signature}\n`);

function encodeBase64Url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}
