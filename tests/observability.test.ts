import { describe, expect, it } from "vitest";

import {
  buildCostSummaryQuery,
  buildModelBreakdownQuery,
  buildStructuredLogEvent,
  isInternalRequest,
  toAnalyticsPoint,
  toCostSummaryResponse,
  toPrometheusMetrics
} from "../workers/observability/src/telemetry";

describe("observability telemetry helpers", () => {
  it("builds a structured log event with a redacted user hash", async () => {
    const event = await buildStructuredLogEvent({
      requestId: "req-1",
      tenantId: "tenant-1",
      userId: "user-1",
      model: "llama-3.1-8b",
      promptTokens: 12,
      completionTokens: 8,
      ttftMs: 120,
      totalMs: 560,
      estimatedCostCents: 0.12,
      actualCostCents: 0.1,
      cacheStatus: "HIT",
      cacheHit: true,
      routingReason: "requested-model",
      via: "workers-ai",
      statusCode: 200
    });

    expect(event.user_id_hash).toMatch(/^[a-f0-9]{16}$/);
    expect(event).toMatchObject({
      request_id: "req-1",
      tenant_id: "tenant-1",
      cache_hit: true,
      estimated_cost_cents: 0.12,
      actual_cost_cents: 0.1
    });
  });

  it("maps events to an analytics datapoint layout", () => {
    expect(
      toAnalyticsPoint({
        requestId: "req-1",
        tenantId: "tenant-1",
        model: "llama-3.1-8b",
        promptTokens: 12,
        completionTokens: 8,
        estimatedCostCents: 0.12,
        actualCostCents: 0.1,
        routingReason: "requested-model",
        via: "workers-ai",
        cacheHit: true,
        statusCode: 200
      })
    ).toMatchObject({
      indexes: ["req-1"]
    });
    expect(
      toAnalyticsPoint({
        requestId: "req-1",
        tenantId: "tenant-1",
        model: "llama-3.1-8b",
        promptTokens: 12,
        completionTokens: 8,
        estimatedCostCents: 0.12,
        actualCostCents: 0.1,
        routingReason: "requested-model",
        via: "workers-ai",
        cacheHit: true,
        statusCode: 200
      }).blobs.slice(0, 6)
    ).toEqual(["tenant-1", "llama-3.1-8b", "requested-model", "workers-ai", "hit", "2xx"]);
  });

  it("builds tenant-scoped cost summary queries", () => {
    const query = buildCostSummaryQuery("llm_requests", 24, "tenant-1");
    expect(query).toContain("FROM llm_requests");
    expect(query).toContain("INTERVAL '24' HOUR");
    expect(query).toContain("blob1 = 'tenant-1'");
    expect(query).not.toContain("NULLIF");
    expect(query).toContain("CASE");
  });

  it("builds a model breakdown query", () => {
    const query = buildModelBreakdownQuery("llm_requests", 12);
    expect(query).toContain("GROUP BY model");
    expect(query).toContain("LIMIT 10");
  });

  it("renders a cost summary and Prometheus metrics output", () => {
    const summary = toCostSummaryResponse(
      {
        requests: 10,
        estimated_cost_cents: 1.2,
        actual_cost_cents: 1.1,
        cache_hit_rate: 0.2,
        error_rate: 0.1,
        p50_ttft_ms: 120,
        p95_ttft_ms: 240,
        p95_total_ms: 1000
      },
      [
        {
          model: "llama-3.1-8b",
          requests: 10,
          estimated_cost_cents: 1.2,
          actual_cost_cents: 1.1,
          cache_hit_rate: 0.2,
          error_rate: 0.1,
          p95_ttft_ms: 240,
          p95_total_ms: 1000
        }
      ],
      24,
      "2026-04-01T00:00:00.000Z"
    );

    expect(summary.totals.actualCostCents).toBe(1.1);
    expect(summary.models[0].model).toBe("llama-3.1-8b");
    expect(toPrometheusMetrics(summary)).toContain('llm_model_actual_cost_cents{model="llama-3.1-8b"} 1.1');
  });

  it("recognizes internal-only hosts", () => {
    expect(isInternalRequest(new URL("https://observability.internal/events"))).toBe(true);
    expect(isInternalRequest(new URL("https://localhost/internal/metrics-summary"))).toBe(true);
    expect(isInternalRequest(new URL("https://llm-observability.example.com/events"))).toBe(false);
  });
});
