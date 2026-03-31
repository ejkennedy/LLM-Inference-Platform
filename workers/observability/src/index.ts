import type { HealthResponse } from "@llm-inference-platform/types";

export interface Env {
  ANALYTICS: AnalyticsEngineDataset;
}

type ObservabilityEvent = {
  requestId?: string;
  userId?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  costCents?: number;
};

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

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const payload = (await request.json()) as ObservabilityEvent;
    console.log(
      JSON.stringify({
        event: "llm_observability",
        payload: {
          ...payload,
          userId: payload.userId ? "redacted" : undefined
        },
        ts: Date.now()
      })
    );

    try {
      env.ANALYTICS.writeDataPoint({
        blobs: [payload.model ?? "unknown"],
        doubles: [
          payload.promptTokens ?? 0,
          payload.completionTokens ?? 0,
          payload.costCents ?? 0
        ],
        indexes: [payload.requestId ?? crypto.randomUUID()]
      });
    } catch (error) {
      console.error("Analytics write failed", error);
    }

    return json({ status: "ok" });
  }
};

function json<T>(value: T, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value, null, 2), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });
}
