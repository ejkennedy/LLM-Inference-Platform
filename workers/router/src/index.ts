import type {
  HealthResponse,
  ModelCatalogueEntry,
  RouterRequest,
  RouterResponse
} from "@llm-inference-platform/types";

export interface Env {
  MODEL_CATALOGUE: KVNamespace;
}

const CACHE_TTL_MS = 60_000;
const DEFAULT_MODEL_ID = "llama-3.1-8b";
const POLICY_VERSION = "2026-03-31.v1";

const defaultCatalogue: Record<string, ModelCatalogueEntry> = {
  "llama-3.1-8b": {
    id: "llama-3.1-8b",
    provider: "workers-ai",
    cfModelId: "@cf/meta/llama-3.1-8b-instruct",
    inputCostPerMtok: 0.2,
    outputCostPerMtok: 0.8,
    maxContextTokens: 128_000,
    enabled: true,
    tier: "fast",
    fallbackTo: "llama-3.1-70b"
  },
  "llama-3.1-70b": {
    id: "llama-3.1-70b",
    provider: "workers-ai",
    cfModelId: "@cf/meta/llama-3.1-70b-instruct",
    inputCostPerMtok: 1.5,
    outputCostPerMtok: 4.5,
    maxContextTokens: 128_000,
    enabled: true,
    tier: "premium"
  }
};

let catalogueCache:
  | {
      expiresAt: number;
      entries: Record<string, ModelCatalogueEntry>;
    }
  | undefined;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json<HealthResponse>({
        status: "ok",
        service: "router",
        ts: new Date().toISOString()
      });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const payload = (await request.json()) as RouterRequest;
    const catalogue = await getCatalogue(env);
    const decision = resolveRoute(payload, catalogue);

    return json<RouterResponse>(decision);
  }
};

function resolveRoute(
  request: RouterRequest,
  catalogue: Record<string, ModelCatalogueEntry>
): RouterResponse {
  const requestedModel = request.requestedModel ?? DEFAULT_MODEL_ID;
  const model = catalogue[requestedModel] ?? catalogue[DEFAULT_MODEL_ID];

  if (!model || !model.enabled) {
    return {
      resolvedModel: DEFAULT_MODEL_ID,
      cfModelId: defaultCatalogue[DEFAULT_MODEL_ID].cfModelId,
      expectedCostCents: estimateCost(request, defaultCatalogue[DEFAULT_MODEL_ID]),
      via: "workers-ai",
      reason: "default-model",
      policyVersion: POLICY_VERSION
    };
  }

  if (request.userTier === "free" && model.tier !== "fast") {
    const fallback = catalogue[DEFAULT_MODEL_ID] ?? defaultCatalogue[DEFAULT_MODEL_ID];
    return {
      resolvedModel: fallback.id,
      cfModelId: fallback.cfModelId,
      expectedCostCents: estimateCost(request, fallback),
      via: fallback.provider,
      reason: "free-tier-cap",
      policyVersion: POLICY_VERSION
    };
  }

  const estimatedCost = estimateCost(request, model);
  if (estimatedCost > request.budgetRemainingCents && model.fallbackTo) {
    const fallback = catalogue[model.fallbackTo];
    if (fallback?.enabled) {
      return {
        resolvedModel: fallback.id,
        cfModelId: fallback.cfModelId,
        expectedCostCents: estimateCost(request, fallback),
        via: fallback.provider,
        reason: "budget-fallback",
        policyVersion: POLICY_VERSION
      };
    }
  }

  return {
    resolvedModel: model.id,
    cfModelId: model.cfModelId,
    expectedCostCents: estimatedCost,
    via: model.provider,
    reason: model.id === requestedModel ? "requested-model" : "catalogue-default",
    policyVersion: POLICY_VERSION
  };
}

async function getCatalogue(env: Env): Promise<Record<string, ModelCatalogueEntry>> {
  const now = Date.now();
  if (catalogueCache && catalogueCache.expiresAt > now) {
    return catalogueCache.entries;
  }

  let entries = defaultCatalogue;
  const raw = await env.MODEL_CATALOGUE.get("models", "json");

  if (isCatalogue(raw)) {
    entries = raw;
  }

  catalogueCache = {
    expiresAt: now + CACHE_TTL_MS,
    entries
  };

  return entries;
}

function estimateCost(request: RouterRequest, model: ModelCatalogueEntry): number {
  const promptTokens = Math.max(request.promptTokensEstimate, 1);
  const completionTokens = Math.max(request.maxOutputTokens ?? 512, 1);
  const inputCost = (promptTokens / 1_000_000) * model.inputCostPerMtok * 100;
  const outputCost = (completionTokens / 1_000_000) * model.outputCostPerMtok * 100;

  return Number((inputCost + outputCost).toFixed(4));
}

function isCatalogue(value: unknown): value is Record<string, ModelCatalogueEntry> {
  if (!value || typeof value !== "object") {
    return false;
  }

  return Object.values(value).every((entry) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }

    const candidate = entry as Partial<ModelCatalogueEntry>;
    return (
      typeof candidate.id === "string" &&
      typeof candidate.cfModelId === "string" &&
      (candidate.provider === "workers-ai" || candidate.provider === "external") &&
      typeof candidate.inputCostPerMtok === "number" &&
      typeof candidate.outputCostPerMtok === "number" &&
      typeof candidate.maxContextTokens === "number" &&
      typeof candidate.enabled === "boolean" &&
      (candidate.tier === "fast" ||
        candidate.tier === "balanced" ||
        candidate.tier === "premium")
    );
  });
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
