/**
 * Discord Gateway — injectable protocol boundary.
 *
 * Keeps WebSocket concerns behind a narrow interface so DiscordChannel
 * can be tested without a real WS and without pulling in discord.js.
 */

import type { WebSocket as WebSocketType } from "ws";

// ---------------------------------------------------------------------------
// Payload shape (subset of Discord Gateway protocol)
// ---------------------------------------------------------------------------

export interface DiscordGatewayPayload {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string;
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface DiscordGatewayLike {
  /** Open a transport connection to `gatewayUrl`. Resolves when transport is ready. */
  connect(gatewayUrl: string, signal: AbortSignal): Promise<void>;

  /** Send a raw JSON-serialisable payload. */
  send(data: unknown): void;

  /** Close with optional code + reason. */
  close(code?: number, reason?: string): void;

  /** Subscribe to incoming parsed payloads. Returns unsubscribe fn. */
  onPayload(handler: (payload: DiscordGatewayPayload) => void): () => void;

  /** Subscribe to close events (code + reason). Returns unsubscribe fn. */
  onClose(handler: (code: number, reason: string) => void): () => void;

  /** Subscribe to transport errors. Returns unsubscribe fn. */
  onError(handler: (error: Error) => void): () => void;
}

// ---------------------------------------------------------------------------
// Production implementation (ws)
// ---------------------------------------------------------------------------

export class DiscordGateway implements DiscordGatewayLike {
  private ws: WebSocketType | null = null;
  private readonly payloadHandlers = new Set<
    (payload: DiscordGatewayPayload) => void
  >();
  private readonly closeHandlers = new Set<
    (code: number, reason: string) => void
  >();
  private readonly errorHandlers = new Set<(error: Error) => void>();

  // -------------------------------------------------------------------
  // DiscordGatewayLike
  // -------------------------------------------------------------------

  async connect(gatewayUrl: string, signal: AbortSignal): Promise<void> {
    if (this.ws) this.close(1000, "reconnect");

    const { WebSocket } = await import("ws");

    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        reject(new Error("DISCORD_GATEWAY_ABORTED"));
        this.ws?.close(1001, "aborted");
      };

      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });

      const ws = new WebSocket(gatewayUrl);
      this.ws = ws;

      ws.on("open", () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      });

      ws.on("message", (data: Buffer) => {
        try {
          const payload = JSON.parse(data.toString()) as DiscordGatewayPayload;
          for (const handler of this.payloadHandlers) handler(payload);
        } catch {
          // Ignore unparseable messages
        }
      });

      ws.on("close", (code: number, reason: Buffer) => {
        this.ws = null;
        signal.removeEventListener("abort", onAbort);
        for (const handler of this.closeHandlers)
          handler(code, reason.toString("utf-8"));
      });

      ws.on("error", (err: Error) => {
        for (const handler of this.errorHandlers) handler(err);
        reject(err);
      });
    });
  }

  send(data: unknown): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify(data));
  }

  close(code = 1000, reason = ""): void {
    this.ws?.close(code, reason);
    this.ws = null;
  }

  onPayload(handler: (payload: DiscordGatewayPayload) => void): () => void {
    this.payloadHandlers.add(handler);
    return () => this.payloadHandlers.delete(handler);
  }

  onClose(handler: (code: number, reason: string) => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  onError(handler: (error: Error) => void): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }
}
