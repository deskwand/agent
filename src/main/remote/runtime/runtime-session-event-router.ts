import type { ServerEvent } from "../../../renderer/types";

export interface RuntimeAssistantDelivery {
  isAgentSession(sessionId: string): boolean;
  deliverAgentResponse(
    sessionId: string,
    turnId: string,
    text: string,
    // Unique assistant message id. A single turn may emit several assistant
    // messages (multi-step / tool-use), each of which must be delivered as an
    // independent message with its own outbound idempotency key.
    messageId?: string,
  ): Promise<void>;
}

/**
 * Route a completed assistant message from SessionManager to Channel Runtime.
 * Returns true only when the event belongs to a known runtime Agent session.
 * Delivery runs asynchronously so the renderer event path remains non-blocking.
 */
export function routeRuntimeAssistantEvent(
  event: ServerEvent,
  delivery: RuntimeAssistantDelivery,
  onError: () => void,
): boolean {
  if (event.type !== "stream.message") return false;
  const { sessionId, message } = event.payload;
  if (
    message.role !== "assistant" ||
    !message.turnId ||
    !delivery.isAgentSession(sessionId)
  ) {
    return false;
  }

  const text = message.content
    .filter(
      (block): block is Extract<typeof block, { type: "text" }> =>
        block.type === "text" && block.text.length > 0,
    )
    .map((block) => block.text)
    .join("\n");
  if (!text) return true;

  void delivery
    .deliverAgentResponse(sessionId, message.turnId, text, message.id)
    .catch(onError);
  return true;
}
