/**
 * WeChat Protocol — injectable, deterministic state machine for QR login,
 * reconnect backoff, and lifecycle events.
 */

export type WeChatQrState = "idle" | "pending" | "scanned" | "confirmed" | "expired";

export interface WeChatProtocolConfig {
  maxRetries: number;
  baseDelayMs: number;
}

export interface WeChatProtocol {
  getQrState(): WeChatQrState;
  transition(state: WeChatQrState): void;
  onQrStateChange(handler: (state: WeChatQrState) => void): () => void;

  /** Compute the next reconnect delay in ms. Returns null when exhausted. */
  nextReconnectDelay(): number | null;
  resetReconnect(): void;

  /** Read-only config for introspecting retry limits. */
  readonly maxRetries: number;
}

// ---------------------------------------------------------------------------
// Valid QR state transitions
// ---------------------------------------------------------------------------
const VALID_TRANSITIONS: Record<WeChatQrState, ReadonlySet<WeChatQrState>> = {
  idle: new Set(["pending", "confirmed"]),
  pending: new Set(["scanned", "expired"]),
  scanned: new Set(["confirmed", "expired"]),
  confirmed: new Set([]),
  expired: new Set(["pending"]),
};

export function createWeChatProtocol(
  config: Partial<WeChatProtocolConfig> = {},
): WeChatProtocol {
  const { maxRetries = 5, baseDelayMs = 1000 } = config;

  let state: WeChatQrState = "idle";
  let reconnectAttempt = 0;
  const qrHandlers = new Set<(state: WeChatQrState) => void>();

  return {
    getQrState(): WeChatQrState {
      return state;
    },

    transition(next: WeChatQrState): void {
      const allowed = VALID_TRANSITIONS[state];
      if (!allowed.has(next)) {
        throw new Error(
          `INVALID_QR_TRANSITION: ${state} -> ${next}`,
        );
      }
      state = next;
      for (const handler of qrHandlers) {
        try {
          handler(next);
        } catch {
          // handler errors must not break the state machine
        }
      }
    },

    onQrStateChange(handler: (s: WeChatQrState) => void): () => void {
      qrHandlers.add(handler);
      return () => qrHandlers.delete(handler);
    },

    nextReconnectDelay(): number | null {
      if (reconnectAttempt >= maxRetries) return null;
      const delay = Math.min(
        baseDelayMs * Math.pow(2, reconnectAttempt),
        60_000,
      );
      reconnectAttempt += 1;
      return delay;
    },

    resetReconnect(): void {
      reconnectAttempt = 0;
    },

    maxRetries,
  };
}
