/**
 * @module main/memory/memory-write-tools
 *
 * Agent-facing tools for upserting and deleting core memory entries.
 *
 * These tools wrap the existing CoreMemoryStore.applyActions() and are
 * intended for use by the background review agent (and optionally by
 * the main agent when memory write is enabled).
 *
 * Exports both ToolDefinitions (for pi-agent registration) and raw
 * functions (for programmatic use by BackgroundReviewService).
 */

import { Type } from "@sinclair/typebox";
import type { CoreMemoryStore } from "./core-memory-store";
import type { AppliedCoreMemoryAction } from "./memory-types";
import { log } from "../utils/logger";

// ---------------------------------------------------------------------------
// Shared parameter schemas
// ---------------------------------------------------------------------------

const CategoryEnum = Type.Union([
  Type.Literal("identity"),
  Type.Literal("preferences"),
  Type.Literal("skills"),
  Type.Literal("interests"),
]);

const MemoryUpsertParams = Type.Object({
  category: CategoryEnum,
  key: Type.String({
    description:
      "Short, stable key for this memory entry (e.g. 'coding-style')",
  }),
  value: Type.String({ description: "The memory value to store" }),
  reason: Type.Optional(
    Type.String({
      description:
        "Why this memory is being recorded (helps with future review)",
    }),
  ),
});

const MemoryDeleteParams = Type.Object({
  key: Type.String({
    description:
      "The combined key (e.g. 'preferences: coding-style') to delete",
  }),
  reason: Type.Optional(
    Type.String({ description: "Why this memory is being deleted" }),
  ),
});

// ---------------------------------------------------------------------------
// Raw functions (for programmatic use)
// ---------------------------------------------------------------------------

export interface MemoryWriteOptions {
  coreStore: CoreMemoryStore;
}

export function memoryUpsert(
  category: string,
  key: string,
  value: string,
  options: MemoryWriteOptions,
): AppliedCoreMemoryAction[] {
  const actions = options.coreStore.applyActions([
    {
      op: "upsert",
      category: category as AppliedCoreMemoryAction["category"],
      key,
      value,
    },
  ]);
  log(`[MemoryWrite] Upserted memory: ${category}: ${key}`);
  return actions;
}

export function memoryDelete(
  key: string,
  options: MemoryWriteOptions,
): AppliedCoreMemoryAction[] {
  const actions = options.coreStore.applyActions([{ op: "delete", key }]);
  log(`[MemoryWrite] Deleted memory: ${key}`);
  return actions;
}

// ---------------------------------------------------------------------------
// ToolDefinitions (for pi-agent registration)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildMemoryWriteTools(options: MemoryWriteOptions): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const memoryUpsertTool: any = {
    name: "memory_upsert",
    label: "memory_upsert",
    description:
      "Upsert a core memory entry. Use this to remember user preferences, identity details, " +
      "skills, and interests. The entry is keyed by category + key. If an entry with the " +
      "same combined key exists, it will be updated. Max 24 entries total.",
    parameters: MemoryUpsertParams as never,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    execute: async (
      _toolCallId: string,
      params: unknown,
      _signal: unknown,
      _onUpdate: unknown,
      _ctx: unknown,
    ) => {
      const { category, key, value } = params as {
        category: string;
        key: string;
        value: string;
      };
      memoryUpsert(category, key, value, options);
      return {
        content: [
          {
            type: "text" as const,
            text: `Memory upserted: ${category}: ${key}`,
          },
        ],
      };
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const memoryDeleteTool: any = {
    name: "memory_delete",
    label: "memory_delete",
    description:
      "Delete an obsolete or contradicted core memory entry. Use the combined key " +
      "(e.g. 'preferences: coding-style') to identify the entry.",
    parameters: MemoryDeleteParams as never,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    execute: async (
      _toolCallId: string,
      params: unknown,
      _signal: unknown,
      _onUpdate: unknown,
      _ctx: unknown,
    ) => {
      const { key } = params as { key: string };
      memoryDelete(key, options);
      return {
        content: [{ type: "text" as const, text: `Memory deleted: ${key}` }],
      };
    },
  };

  return [memoryUpsertTool, memoryDeleteTool];
}
