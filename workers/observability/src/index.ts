import type {
  CostSummaryResponse,
  HealthResponse,
  ObservabilityEvent
} from "@llm-inference-platform/types";

import {
  buildCostSummaryQuery,
  buildModelBreakdownQuery,
  buildStructuredLogEvent,
  isInternalRequest,
  toAnalyticsPoint,
  toCostSummaryResponse,
  toPrometheusMetrics
} from "./telemetry";

export interface Env {
  ANALYTICS?: AnalyticsEngineDataset;
  ANALYTICS_ACCOUNT_ID?: string;
  ANALYTICS_API_TOKEN?: string;
  ANALYTICS_DATASET?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json<HealthResponse>({
        status: "ok",
        service: "observability",
        ts: new Date().toISOString()
      });
    }

    if (request.method === "POST" && url.pathname === "/events") {
      ensureInternalRequest(url);
      const payload = (await request.json()) as Partial<ObservabilityEvent>;
      return ingestEvent(payload as ObservabilityEvent, env);
    }

    if (request.method === "GET" && url.pathname === "/internal/cost-summary") {
      ensureInternalRequest(url);
      const windowHours = parsePositiveInt(url.searchParams.get("windowHours"), 24);
      const tenantId = url.searchParams.get("tenantId") ?? undefined;
      return json(await queryCostSummary(env, windowHours, tenantId));
    }

    if (request.method === "GET" && url.pathname === "/internal/metrics-summary") {
      ensureInternalRequest(url);
      const windowHours = parsePositiveInt(url.searchParams.get("windowHours"), 24);
      const tenantId = url.searchParams.get("tenantId") ?? undefined;
      return json(await queryCostSummary(env, windowHours, tenantId));
    }

    if (request.method === "GET" && url.pathname === "/internal/metrics/prometheus") {
      ensureInternalRequest(url);
      const windowHours = parsePositiveInt(url.searchParams.get("windowHours"), 24);
      const tenantId = url.searchParams.get("tenantId") ?? undefined;
      const summary = await queryCostSummary(env, windowHours, tenantId);
      return new Response(toPrometheusMetrics(summary), {
        headers: {
          "Content-Type": "text/plain; version=0.0.4"
        }
      });
    }

    return new Response(request.method === "GET" ? "Not Found" : "Method Not Allowed", {
      status: request.method === "GET" ? 404 : 405
    });
  }
};

async function ingestEvent(payload: ObservabilityEvent, env: Env): Promise<Response> {
  const logEvent = await buildStructuredLogEvent(payload);
  console.log(JSON.stringify(logEvent));

  try {
    env.ANALYTICS?.writeDataPoint(toAnalyticsPoint(payload));
  } catch (error) {
    console.error("Analytics write failed", error);
  }

  return json({ status: "ok" });
}

async function queryCostSummary(
  env: Env,
  windowHours: number,
  tenantId?: string
): Promise<CostSummaryResponse> {
  const dataset = env.ANALYTICS_DATASET ?? "llm_requests";
  const totals = await runAnalyticsQuery(env, buildCostSummaryQuery(dataset, windowHours, tenantId));
  const models = await runAnalyticsQuery(env, buildModelBreakdownQuery(dataset, windowHours, tenantId));

  return toCostSummaryResponse(totals.rows?.[0], models.rows ?? [], windowHours);
}

async function runAnalyticsQuery(
  env: Env,
  sql: string
): Promise<{ rows?: Array<Record<string, unknown>> }> {
  if (!env.ANALYTICS_ACCOUNT_ID || !env.ANALYTICS_API_TOKEN) {
    throw new Response(
      JSON.stringify({
        status: "error",
        message: "analytics query credentials are not configured"
      }),
      {
        status: 503,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.ANALYTICS_ACCOUNT_ID}/analytics_engine/sql`,
    {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Authorization: `Bearer ${env.ANALYTICS_API_TOKEN}`
      },
      body: sql
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`analytics query failed with status ${response.status}: ${text}`);
  }

  const payload = (await response.json()) as {
    result?: {
      rows?: Array<Record<string, unknown>>;
    };
  };

  return payload.result ?? {};
}

function ensureInternalRequest(url: URL): void {
  if (!isInternalRequest(url)) {
    throw new Response("Forbidden", { status: 403 });
  }
}

function json<T>(value: T, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value, null, 2), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });
}

function parsePositiveInt(value: string | undefined | null, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
