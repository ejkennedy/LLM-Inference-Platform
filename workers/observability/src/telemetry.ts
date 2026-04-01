import type {
  CostSummaryBucket,
  CostSummaryResponse,
  ObservabilityEvent
} from "@llm-inference-platform/types";

export type StructuredLogEvent = {
  ts: number;
  request_id: string;
  tenant_id: string;
  user_id_hash?: string;
  model_resolved: string;
  prompt_tokens: number;
  completion_tokens?: number;
  ttft_ms?: number;
  total_ms?: number;
  estimated_cost_cents: number;
  actual_cost_cents?: number;
  cache_hit: boolean;
  cache_status?: string;
  routing_reason?: string;
  via?: string;
  status_code?: number;
  error_class?: string;
  prompt_id?: string;
  prompt_version?: string;
  finish_reason?: string;
};

export async function buildStructuredLogEvent(
  event: ObservabilityEvent,
  now = Date.now()
): Promise<StructuredLogEvent> {
  return {
    ts: now,
    request_id: event.requestId,
    tenant_id: event.tenantId,
    user_id_hash: event.userId ? await sha256Hex(event.userId) : undefined,
    model_resolved: event.model,
    prompt_tokens: event.promptTokens,
    completion_tokens: event.completionTokens,
    ttft_ms: event.ttftMs,
    total_ms: event.totalMs,
    estimated_cost_cents: event.estimatedCostCents,
    actual_cost_cents: event.actualCostCents,
    cache_hit: event.cacheHit ?? event.cacheStatus === "HIT",
    cache_status: event.cacheStatus,
    routing_reason: event.routingReason,
    via: event.via,
    status_code: event.statusCode,
    error_class: event.errorClass,
    prompt_id: event.promptId,
    prompt_version: event.promptVersion,
    finish_reason: event.finishReason
  };
}

export function toAnalyticsPoint(event: ObservabilityEvent): Parameters<AnalyticsEngineDataset["writeDataPoint"]>[0] {
  return {
    blobs: [
      event.tenantId,
      event.model ?? "unknown",
      event.routingReason ?? "unknown",
      event.via ?? "unknown",
      event.cacheHit || event.cacheStatus === "HIT" ? "hit" : "miss",
      toStatusClass(event.statusCode),
      event.promptId ?? "none",
      event.finishReason ?? "unknown"
    ],
    doubles: [
      event.promptTokens ?? 0,
      event.completionTokens ?? 0,
      event.ttftMs ?? 0,
      event.totalMs ?? 0,
      event.estimatedCostCents ?? 0,
      event.actualCostCents ?? event.estimatedCostCents ?? 0,
      event.cacheHit || event.cacheStatus === "HIT" ? 1 : 0,
      event.statusCode && event.statusCode >= 500 ? 1 : 0,
      event.statusCode ?? 0
    ],
    indexes: [event.requestId]
  };
}

export function buildCostSummaryQuery(
  dataset: string,
  windowHours: number,
  tenantId?: string
): string {
  const where = buildWhereClause(windowHours, tenantId);

  return `
SELECT
  SUM(_sample_interval) AS requests,
  SUM(_sample_interval * double5) AS estimated_cost_cents,
  SUM(_sample_interval * double6) AS actual_cost_cents,
  CASE
    WHEN SUM(_sample_interval) = 0 THEN 0
    ELSE SUM(_sample_interval * double7) / SUM(_sample_interval)
  END AS cache_hit_rate,
  CASE
    WHEN SUM(_sample_interval) = 0 THEN 0
    ELSE SUM(_sample_interval * double8) / SUM(_sample_interval)
  END AS error_rate,
  QUANTILEWEIGHTED(0.5)(double3, _sample_interval) AS p50_ttft_ms,
  QUANTILEWEIGHTED(0.95)(double3, _sample_interval) AS p95_ttft_ms,
  QUANTILEWEIGHTED(0.95)(double4, _sample_interval) AS p95_total_ms
FROM ${dataset}
${where}
FORMAT JSON`.trim();
}

export function buildModelBreakdownQuery(
  dataset: string,
  windowHours: number,
  tenantId?: string
): string {
  const where = buildWhereClause(windowHours, tenantId);

  return `
SELECT
  blob2 AS model,
  SUM(_sample_interval) AS requests,
  SUM(_sample_interval * double5) AS estimated_cost_cents,
  SUM(_sample_interval * double6) AS actual_cost_cents,
  CASE
    WHEN SUM(_sample_interval) = 0 THEN 0
    ELSE SUM(_sample_interval * double7) / SUM(_sample_interval)
  END AS cache_hit_rate,
  CASE
    WHEN SUM(_sample_interval) = 0 THEN 0
    ELSE SUM(_sample_interval * double8) / SUM(_sample_interval)
  END AS error_rate,
  QUANTILEWEIGHTED(0.95)(double3, _sample_interval) AS p95_ttft_ms,
  QUANTILEWEIGHTED(0.95)(double4, _sample_interval) AS p95_total_ms
FROM ${dataset}
${where}
GROUP BY model
ORDER BY actual_cost_cents DESC
LIMIT 10
FORMAT JSON`.trim();
}

export function toCostSummaryResponse(
  totalsRow: Record<string, unknown> | undefined,
  modelRows: Array<Record<string, unknown>>,
  windowHours: number,
  now = new Date().toISOString()
): CostSummaryResponse {
  return {
    windowHours,
    freshness: "near-real-time",
    generatedAt: now,
    totals: {
      requests: asNumber(totalsRow?.requests),
      estimatedCostCents: asNumber(totalsRow?.estimated_cost_cents),
      actualCostCents: asNumber(totalsRow?.actual_cost_cents),
      cacheHitRate: asNumber(totalsRow?.cache_hit_rate),
      errorRate: asNumber(totalsRow?.error_rate),
      p50TtftMs: asOptionalNumber(totalsRow?.p50_ttft_ms),
      p95TtftMs: asOptionalNumber(totalsRow?.p95_ttft_ms),
      p95TotalMs: asOptionalNumber(totalsRow?.p95_total_ms)
    },
    models: modelRows.map(toCostSummaryBucket)
  };
}

export function toPrometheusMetrics(summary: CostSummaryResponse): string {
  const lines = [
    "# HELP llm_requests_total Total requests in the selected window",
    "# TYPE llm_requests_total gauge",
    `llm_requests_total ${summary.totals.requests}`,
    "# HELP llm_actual_cost_cents Total actual spend in cents",
    "# TYPE llm_actual_cost_cents gauge",
    `llm_actual_cost_cents ${summary.totals.actualCostCents}`,
    "# HELP llm_estimated_cost_cents Total estimated spend in cents",
    "# TYPE llm_estimated_cost_cents gauge",
    `llm_estimated_cost_cents ${summary.totals.estimatedCostCents}`,
    "# HELP llm_cache_hit_rate Cache hit ratio",
    "# TYPE llm_cache_hit_rate gauge",
    `llm_cache_hit_rate ${summary.totals.cacheHitRate}`,
    "# HELP llm_error_rate Error ratio",
    "# TYPE llm_error_rate gauge",
    `llm_error_rate ${summary.totals.errorRate}`
  ];

  if (summary.totals.p95TtftMs != null) {
    lines.push("# HELP llm_ttft_p95_ms Window p95 time to first token");
    lines.push("# TYPE llm_ttft_p95_ms gauge");
    lines.push(`llm_ttft_p95_ms ${summary.totals.p95TtftMs}`);
  }

  for (const bucket of summary.models) {
    const labels = `{model="${escapeLabel(bucket.model)}"}`;
    lines.push(`llm_model_requests_total${labels} ${bucket.requests}`);
    lines.push(`llm_model_actual_cost_cents${labels} ${bucket.actualCostCents}`);
    lines.push(`llm_model_cache_hit_rate${labels} ${bucket.cacheHitRate}`);
    lines.push(`llm_model_error_rate${labels} ${bucket.errorRate}`);
    if (bucket.p95TtftMs != null) {
      lines.push(`llm_model_ttft_p95_ms${labels} ${bucket.p95TtftMs}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function isInternalRequest(url: URL): boolean {
  return url.hostname.endsWith(".internal")
    || url.hostname === "127.0.0.1"
    || url.hostname === "localhost";
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

function buildWhereClause(windowHours: number, tenantId?: string): string {
  const clauses = [`timestamp >= NOW() - INTERVAL '${Math.max(windowHours, 1)}' HOUR`];
  if (tenantId) {
    clauses.push(`blob1 = '${escapeSqlLiteral(tenantId)}'`);
  }
  return `WHERE ${clauses.join(" AND ")}`;
}

function toStatusClass(statusCode: number | undefined): string {
  if (!statusCode || statusCode < 100) {
    return "unknown";
  }
  return `${Math.floor(statusCode / 100)}xx`;
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toCostSummaryBucket(row: Record<string, unknown>): CostSummaryBucket {
  return {
    model: typeof row.model === "string" ? row.model : "unknown",
    requests: asNumber(row.requests),
    estimatedCostCents: asNumber(row.estimated_cost_cents),
    actualCostCents: asNumber(row.actual_cost_cents),
    cacheHitRate: asNumber(row.cache_hit_rate),
    errorRate: asNumber(row.error_rate),
    p95TtftMs: asOptionalNumber(row.p95_ttft_ms),
    p95TotalMs: asOptionalNumber(row.p95_total_ms)
  };
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
