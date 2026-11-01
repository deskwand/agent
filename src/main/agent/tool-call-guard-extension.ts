/**
 * @module main/agent/tool-call-guard-extension
 *
 * Bridges a per-session `ToolCallGuard` into pi's `tool_call` hook. pi sessions
 * are cached across turns, so the guard is read through a getter on every call.
 */
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import type { AskUserPromptList, AskUserResult } from "../../shared/ask-user";
import type { ToolCallGuard } from "../extensions/agent-runtime-extension";
import { logError } from "../utils/logger";

const GUARD_FAILED_REASON =
  "Blocked: the safety check failed. Do not retry this action; report it to the user.";

export function createToolCallGuardExtension(
  getGuard: () => ToolCallGuard | undefined,
  requestAskUser:
    | ((cardId: string, questions: AskUserPromptList) => Promise<AskUserResult>)
    | undefined,
): InlineExtension {
  // Parallel tool calls must not show overlapping cards: ask one at a time.
  let askChain: Promise<unknown> = Promise.resolve();

  return (pi) => {
    pi.on("tool_call", async (event) => {
      const guard = getGuard();
      if (!guard) return undefined;
      // `guard:` ids render as a pinned card above the composer (never inside tool blocks).
      const cardId = `guard:${event.toolCallId}`;
      try {
        return await guard(
          { toolName: event.toolName, input: event.input },
          {
            askUser: requestAskUser
              ? (questions) => {
                  const run = askChain.then(() =>
                    requestAskUser(cardId, questions),
                  );
                  askChain = run.catch(() => undefined);
                  return run;
                }
              : undefined,
          },
        );
      } catch (error) {
        logError("[ToolCallGuard] guard failed:", error);
        return { block: true, reason: GUARD_FAILED_REASON };
      }
    });
  };
}
