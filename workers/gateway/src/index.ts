import type { GatewayRequest, GatewayResponse } from "@llm-inference-platform/types";

export interface Env {
  AI: AI;
  MODEL_CATALOGUE: KVNamespace;
  ROUTER: Fetcher;
  RATE_LIMITER: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type,Authorization"
        }
      });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const payload = (await request.json()) as GatewayRequest;
    const messages = payload.messages || [];
    const modelId = payload.model ?? "@cf/meta/llama-3.1-8b-instruct";

    const aiResponse = await env.AI.run(modelId, {
      messages,
      stream: true
    });

    const response = new Response(aiResponse, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache"
      }
    });

    return response;
  }
};
