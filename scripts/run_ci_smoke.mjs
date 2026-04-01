import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const repoRoot = resolve(import.meta.dirname, "..");
const gatewayDevVarsPath = resolve(repoRoot, "workers/gateway/.dev.vars");
const services = [];

writeFileSync(gatewayDevVarsPath, "JWT_SECRET=ci-local-secret\n", "utf8");

try {
  services.push(startService("@llm-inference-platform/router", "dev:ci"));
  services.push(startService("@llm-inference-platform/observability", "dev:ci"));
  services.push(startService("@llm-inference-platform/gateway", "dev:ci"));

  await waitForHealth("http://127.0.0.1:8789/health");
  await waitForHealth("http://127.0.0.1:8790/health");
  await waitForHealth("http://127.0.0.1:8787/health");

  await runCommand("npm", ["run", "smoke:local", "--", "http://127.0.0.1:8787"]);
} finally {
  for (const service of services.reverse()) {
    service.kill("SIGTERM");
  }
}

function startService(workspace, script) {
  mkdirSync(resolve(repoRoot, ".tmp"), { recursive: true });

  const child = spawn("npm", ["run", script, "--workspace", workspace], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env
  });

  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`${workspace} exited early with code ${code}`);
    }
  });

  return child;
}

async function waitForHealth(url) {
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {}

    await delay(1_000);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function runCommand(command, args) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      env: process.env
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise(undefined);
        return;
      }

      rejectPromise(new Error(`${command} ${args.join(" ")} failed with code ${code ?? "unknown"}`));
    });
    child.on("error", rejectPromise);
  });
}
