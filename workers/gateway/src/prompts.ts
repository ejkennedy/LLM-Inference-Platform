import type {
  ChatMessage,
  GatewayRequest,
  PromptRegistryEntry
} from "@llm-inference-platform/types";

export type PromptRegistryEnv = {
  PROMPT_REGISTRY?: KVNamespace;
};

const CACHE_TTL_MS = 60_000;

const defaultPromptRegistry: Record<string, PromptRegistryEntry> = {
  "concise-assistant:v1": {
    promptId: "concise-assistant",
    version: "v1",
    promptText: "You are a concise assistant. Answer directly, precisely, and avoid filler.",
    checksum: checksum("You are a concise assistant. Answer directly, precisely, and avoid filler."),
    lastUpdatedBy: "repo-seed",
    cachePolicy: {
      promptClass: "deterministic-general",
      ttlSeconds: 300,
      bypass: false,
      userScoped: false
    }
  },
  "fresh-research:v1": {
    promptId: "fresh-research",
    version: "v1",
    promptText: "You are a research assistant. Prefer up-to-date factual answers and say when freshness matters.",
    checksum: checksum("You are a research assistant. Prefer up-to-date factual answers and say when freshness matters."),
    lastUpdatedBy: "repo-seed",
    cachePolicy: {
      promptClass: "freshness-sensitive",
      ttlSeconds: 0,
      bypass: true,
      userScoped: true
    }
  }
};

let promptCache:
  | {
      expiresAt: number;
      entries: Record<string, PromptRegistryEntry>;
    }
  | undefined;

export async function resolvePromptEntry(
  env: PromptRegistryEnv,
  payload: GatewayRequest
): Promise<PromptRegistryEntry | undefined> {
  const promptId = payload.promptId ?? undefined;
  if (!promptId) {
    return undefined;
  }

  const version = payload.promptVersion ?? "v1";
  const entries = await getPromptRegistry(env);
  return entries[toPromptRegistryKey(promptId, version)];
}

export function applyPromptEntry(
  messages: ChatMessage[],
  promptEntry: PromptRegistryEntry | undefined
): ChatMessage[] {
  if (!promptEntry) {
    return messages;
  }

  return [
    {
      role: "system",
      content: promptEntry.promptText
    },
    ...messages
  ];
}

export function toPromptRegistryKey(promptId: string, version: string): string {
  return `${promptId}:${version}`;
}

async function getPromptRegistry(
  env: PromptRegistryEnv
): Promise<Record<string, PromptRegistryEntry>> {
  const now = Date.now();
  if (promptCache && promptCache.expiresAt > now) {
    return promptCache.entries;
  }

  let entries = defaultPromptRegistry;
  const raw = env.PROMPT_REGISTRY
    ? await env.PROMPT_REGISTRY.get("prompts", "json")
    : null;

  if (isPromptRegistry(raw)) {
    entries = raw;
  }

  promptCache = {
    expiresAt: now + CACHE_TTL_MS,
    entries
  };

  return entries;
}

function isPromptRegistry(
  value: unknown
): value is Record<string, PromptRegistryEntry> {
  if (!value || typeof value !== "object") {
    return false;
  }

  return Object.values(value).every((entry) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }

    const candidate = entry as Partial<PromptRegistryEntry>;
    return (
      typeof candidate.promptId === "string" &&
      typeof candidate.version === "string" &&
      typeof candidate.promptText === "string" &&
      typeof candidate.checksum === "string" &&
      typeof candidate.lastUpdatedBy === "string"
    );
  });
}

function checksum(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `fnv1a:${(hash >>> 0).toString(16)}`;
}
