import { Type } from "@sinclair/typebox";
import type {
  AppliedCoreMemoryAction,
  CoreMemoryCategory,
  MemoryToolDefinition,
} from "./memory-types";

const CategoryEnum = Type.Union([
  Type.Literal("identity"),
  Type.Literal("preferences"),
  Type.Literal("skills"),
  Type.Literal("interests"),
]);

const MemoryUpsertParams = Type.Object({
  category: CategoryEnum,
  key: Type.String({
    minLength: 1,
    description:
      "Short, stable key for this memory entry (e.g. 'coding-style')",
  }),
  value: Type.String({
    minLength: 1,
    maxLength: 500,
    description: "A compact, stable cross-session fact to remember",
  }),
});

const MemoryDeleteParams = Type.Object({
  key: Type.String({
    minLength: 1,
    description: "The combined key (e.g. 'preferences.coding-style') to delete",
  }),
});

export interface MemoryWriteOptions {
  upsert: (
    category: CoreMemoryCategory,
    key: string,
    value: string,
  ) => Promise<AppliedCoreMemoryAction[]>;
  delete: (key: string) => Promise<AppliedCoreMemoryAction[]>;
}

export function buildMemoryWriteTools(
  options: MemoryWriteOptions,
): MemoryToolDefinition[] {
  const memoryUpsertTool: MemoryToolDefinition = {
    name: "memory_upsert",
    label: "memory_upsert",
    description:
      "Remember or replace stable cross-session user identity, preference, skill, or interest information. Use only when the user explicitly asks to remember it.",
    parameters: MemoryUpsertParams,
    async execute(_toolCallId, params) {
      const input = params as {
        category: CoreMemoryCategory;
        key: string;
        value: string;
      };
      const category = input.category;
      const key = String(input.key || "").trim();
      const value = String(input.value || "").trim();
      await options.upsert(category, key, value);
      return {
        content: [
          {
            type: "text" as const,
            text: `Memory upserted: ${category}.${key}`,
          },
        ],
        details: undefined as unknown,
      };
    },
  };

  const memoryDeleteTool: MemoryToolDefinition = {
    name: "memory_delete",
    label: "memory_delete",
    description:
      "Forget obsolete or contradicted Core Memory when the user explicitly asks. Use the combined key returned by memory_search.",
    parameters: MemoryDeleteParams,
    async execute(_toolCallId, params) {
      const key = String((params as { key: string }).key || "").trim();
      await options.delete(key);
      return {
        content: [{ type: "text" as const, text: `Memory deleted: ${key}` }],
        details: undefined as unknown,
      };
    },
  };

  return [memoryUpsertTool, memoryDeleteTool];
}
