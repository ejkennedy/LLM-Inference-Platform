import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const args = parseArgs(process.argv.slice(2));
const targetUrl = args._[0];
const bearerToken = process.env.BENCHMARK_JWT || process.env.SMOKE_JWT;

if (!targetUrl) {
  fail("Usage: npm run benchmark:gateway -- <gateway-url> [--requests 20] [--concurrency 4] [--out benchmarks/report.json]");
}

if (!bearerToken) {
  fail("Set BENCHMARK_JWT or SMOKE_JWT before running the benchmark.");
}

const requests = parsePositiveInt(args.requests, 20);
const concurrency = parsePositiveInt(args.concurrency, 4);
const outFile = args.out;
const thresholdP95TtftMs = parseOptionalNumber(args["threshold-p95-ttft-ms"]);
const thresholdP95TotalMs = parseOptionalNumber(args["threshold-p95-total-ms"]);
const thresholdErrorRate = parseOptionalNumber(args["threshold-error-rate"]);

const state = {
  completed: 0,
  ok: 0,
  failed: 0,
  ttftMs: [],
  totalMs: [],
  statusCodes: new Map()
};

await Promise.all(
  Array.from({ length: Math.min(concurrency, requests) }, () => worker())
);

const report = {
  gatewayUrl: targetUrl,
  requests,
  concurrency,
  generatedAt: new Date().toISOString(),
  results: {
    ok: state.ok,
    failed: state.failed,
    errorRate: requests === 0 ? 0 : state.failed / requests,
    p50TtftMs: percentile(state.ttftMs, 0.5),
    p95TtftMs: percentile(state.ttftMs, 0.95),
    p50TotalMs: percentile(state.totalMs, 0.5),
    p95TotalMs: percentile(state.totalMs, 0.95)
  },
  statusCodes: Object.fromEntries([...state.statusCodes.entries()].sort((a, b) => a[0] - b[0]))
};

if (outFile) {
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify(report, null, 2));

if (thresholdP95TtftMs != null && (report.results.p95TtftMs ?? 0) > thresholdP95TtftMs) {
  fail(`p95 TTFT ${report.results.p95TtftMs} exceeded threshold ${thresholdP95TtftMs}`);
}
if (thresholdP95TotalMs != null && (report.results.p95TotalMs ?? 0) > thresholdP95TotalMs) {
  fail(`p95 total latency ${report.results.p95TotalMs} exceeded threshold ${thresholdP95TotalMs}`);
}
if (thresholdErrorRate != null && report.results.errorRate > thresholdErrorRate) {
  fail(`error rate ${report.results.errorRate} exceeded threshold ${thresholdErrorRate}`);
}

async function worker() {
  while (state.completed < requests) {
    const current = state.completed;
    if (current >= requests) {
      return;
    }
    state.completed += 1;
    const result = await runSingleRequest(targetUrl, bearerToken);
    state.statusCodes.set(result.status, (state.statusCodes.get(result.status) ?? 0) + 1);
    if (result.ok) {
      state.ok += 1;
      if (result.ttftMs != null) {
        state.ttftMs.push(result.ttftMs);
      }
      if (result.totalMs != null) {
        state.totalMs.push(result.totalMs);
      }
    } else {
      state.failed += 1;
    }
  }
}

async function runSingleRequest(gatewayUrl, token) {
  const start = performance.now();
  const response = await fetch(`${gatewayUrl.replace(/\/$/, "")}/v1/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messages: [
        {
          role: "user",
          content: "Benchmark this edge inference request in one short sentence."
        }
      ],
      stream: true
    })
  });

  if (!response.body) {
    return {
      ok: response.ok,
      status: response.status
    };
  }

  const reader = response.body.getReader();
  let ttftMs;

  while (true) {
    const { done, value } = await reader.read();
    if (!done && ttftMs == null && value && value.length > 0) {
      ttftMs = Math.round(performance.now() - start);
    }
    if (done) {
      break;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    ttftMs,
    totalMs: Math.round(performance.now() - start)
  };
}

function percentile(values, p) {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function parseArgs(argv) {
  const output = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      output._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      output[key] = "true";
      continue;
    }
    output[key] = next;
    index += 1;
  }
  return output;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalNumber(value) {
  if (value == null) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
