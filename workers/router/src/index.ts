import type { RouterRequest, RouterResponse } from "@llm-inference-platform/types";

export interface Env {
  MODEL_CATALOGUE: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const payload = (await request.json()) as RouterRequest;
    const model = payload.requestedModel || "llama-3.1-8b";

    const output: RouterResponse = {
      resolvedModel: model,
      cfModelId: `@cf/meta/${model}-instruct`,
      expectedCostCents: 50,
      via: "workers-ai",
      reason: "default"
    };

    return new Response(JSON.stringify(output), {
      headers: { "Content-Type": "application/json" }
    });
  }
};
