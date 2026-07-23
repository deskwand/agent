import { describe, expect, it } from "vitest";
import { CoreMemoryExtractor } from "../../main/memory/core-memory-extractor";
import type {
  MemoryCompletionRequest,
  MemoryLLMClientLike,
} from "../../main/memory/memory-llm-client";

function createExtractor(actions: unknown[]): CoreMemoryExtractor {
  const llm: MemoryLLMClientLike = {
    async complete(_request: MemoryCompletionRequest) {
      return { text: JSON.stringify({ actions }) };
    },
    async embed() {
      return [];
    },
  };
  return new CoreMemoryExtractor(llm);
}

const input = {
  sessionId: "session-1",
  sessionDate: "2026-07-23",
  turns: [{ role: "user", content: "Remember durable facts." }],
  existingCorePromptBlock: "None",
};

describe("CoreMemoryExtractor", () => {
  it("returns at most five valid durable-memory actions", async () => {
    const validActions = Array.from({ length: 6 }, (_, index) => ({
      op: "upsert",
      category: "preferences",
      key: `preference-${index}`,
      value: `value-${index}`,
    }));
    const extractor = createExtractor([
      { ...validActions[0], category: "project" },
      { ...validActions[0], key: "missing-value", value: null },
      { ...validActions[0], key: "too-long", value: "x".repeat(501) },
      ...validActions,
    ]);

    await expect(extractor.extract(input)).resolves.toEqual(
      validActions.slice(0, 5),
    );
  });

  it("keeps valid deletes while rejecting malformed neighboring actions", async () => {
    const extractor = createExtractor([
      { op: "delete", key: "preferences.language" },
      { op: "delete", category: "preferences", key: "language" },
      { op: "delete", category: "project", key: "project.setting" },
      { op: "delete", key: "   " },
      {
        op: "update",
        category: "skills",
        key: "typescript",
        value: "Uses TypeScript for long-lived projects.",
      },
      {
        op: "upsert",
        category: "unknown",
        key: "invalid-category",
        value: "ignored",
      },
    ]);

    await expect(extractor.extract(input)).resolves.toEqual([
      {
        op: "delete",
        category: undefined,
        key: "preferences.language",
        value: null,
      },
      {
        op: "delete",
        category: "preferences",
        key: "language",
        value: null,
      },
      {
        op: "update",
        category: "skills",
        key: "typescript",
        value: "Uses TypeScript for long-lived projects.",
      },
    ]);
  });
});
