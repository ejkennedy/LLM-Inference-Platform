const gatewayUrl = process.argv[2];

if (!gatewayUrl) {
  fail("Usage: npm run alerts:check -- <gateway-url>");
}

const token = process.env.ALERT_JWT ?? process.env.SMOKE_JWT;

if (!token) {
  fail("Missing ALERT_JWT or SMOKE_JWT");
}

const config = {
  environment: process.env.ALERT_ENVIRONMENT ?? "manual",
  tenantId: process.env.ALERT_TENANT_ID,
  windowHours: parsePositiveInt(process.env.ALERT_WINDOW_HOURS, 24),
  maxActualCostCents: parseOptionalNumber(process.env.ALERT_MAX_ACTUAL_COST_CENTS, 1000),
  maxErrorRate: parseOptionalNumber(process.env.ALERT_MAX_ERROR_RATE, 0.01),
  maxP95TtftMs: parseOptionalNumber(process.env.ALERT_MAX_P95_TTFT_MS, 5000),
  maxP95TotalMs: parseOptionalNumber(process.env.ALERT_MAX_P95_TOTAL_MS),
  webhookUrl: process.env.ALERT_WEBHOOK_URL
};

const summaryUrl = new URL(`${stripTrailingSlash(gatewayUrl)}/v1/admin/cost-summary`);
summaryUrl.searchParams.set("windowHours", String(config.windowHours));
if (config.tenantId) {
  summaryUrl.searchParams.set("tenantId", config.tenantId);
}

const response = await fetch(summaryUrl, {
  headers: {
    Authorization: `Bearer ${token}`
  }
});

if (!response.ok) {
  fail(`alert summary request failed with status ${response.status}`);
}

const summary = await response.json();
const breaches = evaluateBreaches(summary, config);
const result = {
  checkedAt: new Date().toISOString(),
  environment: config.environment,
  gatewayUrl: stripTrailingSlash(gatewayUrl),
  tenantId: config.tenantId ?? null,
  thresholds: {
    maxActualCostCents: config.maxActualCostCents,
    maxErrorRate: config.maxErrorRate,
    maxP95TtftMs: config.maxP95TtftMs,
    maxP95TotalMs: config.maxP95TotalMs ?? null
  },
  summary,
  breaches
};

if (breaches.length === 0) {
  console.log(JSON.stringify({ status: "ok", ...result }, null, 2));
  process.exit(0);
}

console.error(JSON.stringify({ status: "alert", ...result }, null, 2));

if (config.webhookUrl) {
  await sendWebhook(config.webhookUrl, result);
}

process.exit(1);

function evaluateBreaches(summary, config) {
  const totals = summary?.totals ?? {};
  const breaches = [];

  checkThreshold(
    breaches,
    "actualCostCents",
    asNumber(totals.actualCostCents),
    config.maxActualCostCents,
    "actual cost"
  );
  checkThreshold(
    breaches,
    "errorRate",
    asNumber(totals.errorRate),
    config.maxErrorRate,
    "error rate"
  );
  checkThreshold(
    breaches,
    "p95TtftMs",
    asNumber(totals.p95TtftMs),
    config.maxP95TtftMs,
    "p95 TTFT"
  );
  checkThreshold(
    breaches,
    "p95TotalMs",
    asNumber(totals.p95TotalMs),
    config.maxP95TotalMs,
    "p95 total latency"
  );

  return breaches;
}

function checkThreshold(breaches, field, actual, threshold, label) {
  if (threshold == null || actual == null) {
    return;
  }
  if (actual > threshold) {
    breaches.push({
      field,
      label,
      threshold,
      actual
    });
  }
}

async function sendWebhook(url, result) {
  const text = [
    `LLM platform alert triggered for ${result.environment}`,
    ...result.breaches.map(
      (breach) => `${breach.label} ${breach.actual} exceeded threshold ${breach.threshold}`
    )
  ].join("\n");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text,
      ...result
    })
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`alert webhook failed with status ${response.status}: ${body}`);
  }
}

function stripTrailingSlash(value) {
  return value.replace(/\/$/, "");
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalNumber(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
