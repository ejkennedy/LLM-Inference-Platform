import type {
  HealthResponse,
  ModelCatalogueEntry,
  RouterRequest,
  RouterResponse
} from "@llm-inference-platform/types";
import { defaultCatalogue, resolveRoute } from "./policy";

export interface Env {
  MODEL_CATALOGUE?: KVNamespace;
}

const CACHE_TTL_MS = 60_000;

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

async function getCatalogue(env: Env): Promise<Record<string, ModelCatalogueEntry>> {
  const now = Date.now();
  if (catalogueCache && catalogueCache.expiresAt > now) {
    return catalogueCache.entries;
  }

  let entries = defaultCatalogue;
  const raw = env.MODEL_CATALOGUE
    ? await env.MODEL_CATALOGUE.get("models", "json")
    : null;

  if (isCatalogue(raw)) {
    entries = raw;
  }

  catalogueCache = {
    expiresAt: now + CACHE_TTL_MS,
    entries
  };

  return entries;
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
