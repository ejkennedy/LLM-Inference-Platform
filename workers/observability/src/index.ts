export interface Env {
  ANALYTICS: AnalyticsEngineNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const payload = await request.json();
    console.log(JSON.stringify({ event: "llm_observability", payload, ts: Date.now() }));

    try {
      await env.ANALYTICS.writeDataPoint({
        blobs: [payload.userId || "unknown", payload.model || "unknown"],
        doubles: [payload.promptTokens || 0, payload.completionTokens || 0, payload.costCents || 0],
        indexes: [payload.requestId || "unknown"]
      });
    } catch (error) {
      console.error("Analytics write failed", error);
    }

    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { "Content-Type": "application/json" }
    });
  }
};
