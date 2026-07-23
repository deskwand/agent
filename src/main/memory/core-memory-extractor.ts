import { CORE_MEMORY_UPDATE_SYSTEM_PROMPT } from "./memory-prompts";
import type { MemoryLLMClientLike } from "./memory-llm-client";
import type {
  CoreMemoryActionInput,
  CoreMemoryCategory,
  MemoryTranscriptTurn,
} from "./memory-types";
import { compactTranscript, extractJson } from "./memory-utils";

const MAX_ACTIONS = 5;
const MAX_VALUE_CHARS = 500;
const CORE_CATEGORIES = new Set<CoreMemoryCategory>([
  "identity",
  "preferences",
  "skills",
  "interests",
]);

export class CoreMemoryExtractor {
  constructor(
    private readonly llm: MemoryLLMClientLike,
    private readonly systemPrompt = CORE_MEMORY_UPDATE_SYSTEM_PROMPT,
  ) {}

  async extract(params: {
    sessionId: string;
    sessionDate?: string;
    turns: MemoryTranscriptTurn[];
    existingCorePromptBlock: string;
  }): Promise<CoreMemoryActionInput[]> {
    const conversationText = compactTranscript(params.turns);
    if (!conversationText.trim()) {
      return [];
    }

    const response = await this.llm.complete({
      systemPrompt: this.systemPrompt,
      userPrompt: [
        "Existing core memory:",
        params.existingCorePromptBlock,
        "",
        `Session ID: ${params.sessionId}`,
        params.sessionDate ? `Session Date: ${params.sessionDate}` : "",
        "Session transcript:",
        conversationText,
      ]
        .filter(Boolean)
        .join("\n"),
      temperature: 0,
      maxTokens: 16_000,
    });

    const payload = extractJson(response.text);
    if (!payload || typeof payload !== "object") {
      return [];
    }

    const actions = (payload as { actions?: unknown }).actions;
    if (!Array.isArray(actions)) {
      return [];
    }

    const normalized = actions
      .map((action): CoreMemoryActionInput | null => {
        if (!action || typeof action !== "object") {
          return null;
        }
        const input = action as {
          op?: unknown;
          category?: unknown;
          key?: unknown;
          value?: unknown;
        };
        const op =
          typeof input.op === "string" ? input.op.toLowerCase().trim() : "";
        if (
          op !== "add" &&
          op !== "update" &&
          op !== "upsert" &&
          op !== "delete"
        ) {
          return null;
        }
        const key = typeof input.key === "string" ? input.key.trim() : "";
        if (!key) {
          return null;
        }
        const parsedCategory =
          typeof input.category === "string"
            ? (input.category.trim() as CoreMemoryCategory)
            : undefined;
        const category =
          parsedCategory && CORE_CATEGORIES.has(parsedCategory)
            ? parsedCategory
            : undefined;
        if (op === "delete") {
          if (input.category != null && !category) {
            return null;
          }
          return {
            op,
            category,
            key,
            value: null,
          } satisfies CoreMemoryActionInput;
        }
        const value = typeof input.value === "string" ? input.value.trim() : "";
        if (
          !category ||
          !CORE_CATEGORIES.has(category) ||
          !value ||
          value.length > MAX_VALUE_CHARS
        ) {
          return null;
        }
        return {
          op,
          category,
          key,
          value,
        } satisfies CoreMemoryActionInput;
      })
      .filter((item): item is CoreMemoryActionInput => Boolean(item))
      .slice(0, MAX_ACTIONS);

    return normalized;
  }
}
