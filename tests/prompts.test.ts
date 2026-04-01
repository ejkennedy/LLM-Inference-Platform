import { describe, expect, it } from "vitest";

import {
  applyPromptEntry,
  resolvePromptEntry
} from "../workers/gateway/src/prompts";

describe("gateway prompt registry", () => {
  it("resolves the default prompt registry entry", async () => {
    const entry = await resolvePromptEntry({}, {
      messages: [],
      promptId: "concise-assistant",
      promptVersion: "v1"
    });

    expect(entry).toMatchObject({
      promptId: "concise-assistant",
      version: "v1"
    });
  });

  it("prepends the resolved prompt as a system message", () => {
    const messages = applyPromptEntry(
      [{ role: "user", content: "hello" }],
      {
        promptId: "concise-assistant",
        version: "v1",
        promptText: "Be concise.",
        checksum: "checksum",
        lastUpdatedBy: "tester"
      }
    );

    expect(messages[0]).toEqual({
      role: "system",
      content: "Be concise."
    });
    expect(messages[1]).toEqual({
      role: "user",
      content: "hello"
    });
  });
});
