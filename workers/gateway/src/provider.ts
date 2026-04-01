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
  requestId: string,
  routing: RouterResponse
): ReadableStream<Uint8Array> | { response: string } {
  const userPrompt = messages.at(-1)?.content ?? "Hello from the mock gateway";
  const output = `Mock response for "${userPrompt}" via ${routing.resolvedModel}.`;

  if (!stream) {
    return { response: output };
  }

  const encoder = new TextEncoder();
  const frames = [
    `event: meta\ndata: ${JSON.stringify(buildGatewayMeta(requestId, routing))}\n\n`,
    `event: token\ndata: ${JSON.stringify({ text: output })}\n\n`,
    "event: usage\ndata: {\"promptTokens\":0,\"completionTokens\":0,\"totalTokens\":0}\n\n",
    `event: summary\ndata: ${JSON.stringify({ finishReason: "stop" })}\n\n`,
    "data: [DONE]\n\n"
  ];

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    }
  });
}
