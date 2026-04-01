import type { ChatMessage, RouterResponse } from "@llm-inference-platform/types";

export type GatewayAiOptions = {
  gateway?: {
    id: string;
    skipCache?: boolean;
    cacheTtl?: number;
  };
};

export function buildAiRunOptions(env: {
  AI_GATEWAY_ID?: string;
  AI_GATEWAY_SKIP_CACHE?: string;
  AI_GATEWAY_CACHE_TTL?: string;
}): GatewayAiOptions | undefined {
  if (!env.AI_GATEWAY_ID) {
    return undefined;
  }

  const gateway: NonNullable<GatewayAiOptions["gateway"]> = {
    id: env.AI_GATEWAY_ID
  };

  const options: GatewayAiOptions = {
    gateway
  };

  if (env.AI_GATEWAY_SKIP_CACHE === "true") {
    gateway.skipCache = true;
  }

  if (env.AI_GATEWAY_CACHE_TTL) {
    const cacheTtl = Number(env.AI_GATEWAY_CACHE_TTL);
    if (Number.isFinite(cacheTtl) && cacheTtl > 0) {
      gateway.cacheTtl = cacheTtl;
    }
  }

  return options;
}

export function buildGatewayMeta(requestId: string, routing: RouterResponse) {
  return {
    requestId,
    model: routing.resolvedModel,
    policyVersion: routing.policyVersion,
    routeReason: routing.reason,
    via: routing.via
  };
}

export function createMockAiResponse(
  messages: ChatMessage[],
  stream: boolean,
  _requestId: string,
  routing: RouterResponse
): AsyncIterable<{ response?: string; done?: boolean; usage?: Record<string, unknown> }> | { response: string } {
  const userPrompt = messages.at(-1)?.content ?? "Hello from the mock gateway";
  const output = `Mock response for "${userPrompt}" via ${routing.resolvedModel}.`;

  if (!stream) {
    return { response: output };
  }

  return {
    async *[Symbol.asyncIterator]() {
      for (const token of output.split(" ")) {
        yield {
          response: `${token} `
        };
      }
      yield {
        usage: {
          prompt_tokens: 0,
          completion_tokens: Math.max(Math.ceil(output.length / 4), 1),
          total_tokens: Math.max(Math.ceil(output.length / 4), 1)
        },
        done: true
      };
    }
  };
}
