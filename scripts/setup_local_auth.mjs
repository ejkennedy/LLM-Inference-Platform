import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import crypto from "node:crypto";

const repoRoot = resolve(import.meta.dirname, "..");
const devVarsPath = resolve(repoRoot, "workers/gateway/.dev.vars");
const providedSecret = process.argv[2];
const secret = providedSecret || crypto.randomBytes(32).toString("hex");

mkdirSync(dirname(devVarsPath), { recursive: true });

const current = existsSync(devVarsPath) ? readFileSync(devVarsPath, "utf8") : "";
const lines = current
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((line) => !line.startsWith("JWT_SECRET="));
lines.unshift(`JWT_SECRET=${secret}`);
writeFileSync(devVarsPath, `${lines.join("\n")}\n`, "utf8");

process.stdout.write(`Wrote ${devVarsPath}\n`);
process.stdout.write("Local JWT secret is ready.\n");
process.stdout.write("Generate a token with:\n");
process.stdout.write("npm run token:dev\n");
