import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { createNestedToolCallTracker } from "./nested-tool-call-tracker";

interface NestedToolSessionEventOptions {
  tracker: ReturnType<typeof createNestedToolCallTracker>;
  isAborted: () => boolean;
  publish: (parentId: string) => void;
  handleEvent: (event: AgentSessionEvent) => void;
}

/** Keep the final-record exception and cancellation gate in one production boundary. */
export function createNestedToolSessionEventHandler(
  options: NestedToolSessionEventOptions,
): (event: AgentSessionEvent) => void {
  const { tracker, isAborted, publish, handleEvent } = options;
  return (event) => {
    if (event.type === "message_end" && event.message.role === "toolResult") {
      const message = event.message;
      const runtime = tracker.get(message.toolCallId);
      if (runtime?.snapshot.parentToolCallId === message.toolCallId) {
        const details = record(message.details);
        tracker.finishParent(
          message.toolCallId,
          message.nestedCalls,
          details?.calls,
          message.isError,
        );
        publish(message.toolCallId);
        return;
      }
    }
    if (isAborted()) return;
    if (event.type === "tool_execution_start") {
      if (
        event.toolName.toLowerCase() === "codemode" &&
        !event.parentToolCallId
      ) {
        tracker.startParent(event.toolCallId);
        publish(event.toolCallId);
      }
      if (event.parentToolCallId && tracker.get(event.parentToolCallId)) {
        tracker.start(event.parentToolCallId, {
          id: event.toolCallId,
          name: event.toolName,
          input: record(event.args),
        });
        publish(event.parentToolCallId);
      }
    }
    handleEvent(event);
  };
}

/** Empty snapshot updates are not a request to clear an existing text partial. */
export function isMetadataOnlyCodemodeUpdate(
  toolName: string,
  partialResult: unknown,
): boolean {
  if (toolName.toLowerCase() !== "codemode") return false;
  const partial = record(partialResult);
  if (!partial) return false;
  const content: unknown[] = Array.isArray(partial.content)
    ? partial.content
    : [];
  const hasOutput = content.some((value) => {
    const block = record(value);
    return (
      block?.type === "image" ||
      (block?.type === "text" &&
        typeof block.text === "string" &&
        block.text.length > 0)
    );
  });
  const details = record(partial.details);
  return (
    !hasOutput &&
    !(typeof details?.diff === "string" && details.diff.length > 0) &&
    !(
      Array.isArray(details?.openCoworkImages) &&
      details.openCoworkImages.length > 0
    )
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
