import type {
  ModelCatalogueEntry,
  RouterRequest,
  RouterResponse
} from "@llm-inference-platform/types";

export const DEFAULT_MODEL_ID = "llama-3.1-8b";
export const POLICY_VERSION = "2026-03-31.v1";

export const defaultCatalogue: Record<string, ModelCatalogueEntry> = {
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
    tier: "premium",
    fallbackTo: "gpt-4.1-mini"
  },
  "gpt-4.1-mini": {
    id: "gpt-4.1-mini",
    provider: "external",
    cfModelId: "gpt-4.1-mini",
    inputCostPerMtok: 0.4,
    outputCostPerMtok: 1.6,
    maxContextTokens: 128_000,
    enabled: true,
    tier: "balanced",
    fallbackTo: "llama-3.1-8b"
  }
};

export function resolveRoute(
  request: RouterRequest,
  catalogue: Record<string, ModelCatalogueEntry>
): RouterResponse {
  const requestedModel = request.requestedModel ?? DEFAULT_MODEL_ID;
  const providerAllowlist = request.providerAllowlist?.length
    ? new Set(request.providerAllowlist)
    : undefined;
  const model = selectRoutableModel(
    requestedModel,
    catalogue,
    providerAllowlist
  ) ?? selectRoutableModel(DEFAULT_MODEL_ID, defaultCatalogue, providerAllowlist);

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
    const fallback = selectRoutableModel(DEFAULT_MODEL_ID, catalogue, providerAllowlist)
      ?? selectRoutableModel(DEFAULT_MODEL_ID, defaultCatalogue, providerAllowlist)
      ?? defaultCatalogue[DEFAULT_MODEL_ID];
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
    const fallback = selectRoutableModel(model.fallbackTo, catalogue, providerAllowlist);
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

function selectRoutableModel(
  modelId: string,
  catalogue: Record<string, ModelCatalogueEntry>,
  providerAllowlist?: Set<"workers-ai" | "external">
): ModelCatalogueEntry | undefined {
  const visited = new Set<string>();
  let currentId: string | undefined = modelId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const model: ModelCatalogueEntry | undefined = catalogue[currentId];
    if (!model) {
      return undefined;
    }
    if (!model.enabled) {
      currentId = model.fallbackTo;
      continue;
    }
    if (!providerAllowlist || providerAllowlist.has(model.provider)) {
      return model;
    }
    currentId = model.fallbackTo;
  }

  return undefined;
}

export function estimateCost(request: RouterRequest, model: ModelCatalogueEntry): number {
  const promptTokens = Math.max(request.promptTokensEstimate, 1);
  const completionTokens = Math.max(request.maxOutputTokens ?? 512, 1);
  const inputCost = (promptTokens / 1_000_000) * model.inputCostPerMtok * 100;
  const outputCost = (completionTokens / 1_000_000) * model.outputCostPerMtok * 100;

  return Number((inputCost + outputCost).toFixed(4));
}
