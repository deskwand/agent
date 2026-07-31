/**
 * QQ Bot Gateway — narrow protocol boundary over fetch + ws primitives.
 *
 * Responsibilities:
 *  - Token acquisition (HTTP POST to QQ OAuth endpoint)
 *  - WebSocket connect (Identify handshake)
 *  - Heartbeat (opcode 1 / 11 loop)
 *  - Resume / reconnect with exponential backoff (opcode 6 / 7)
 *  - Event dispatch (opcode 0) into typed QqEvent
 *  - Clean stop (close WS, clear timers, cancel reconnect)
 */

import WebSocket from "ws";

// ---------------------------------------------------------------------------
// QQ Bot Gateway protocol constants
// ---------------------------------------------------------------------------

/** Gateway opcodes as defined by QQ Bot WebSocket protocol. */
const enum GatewayOp {
  Dispatch = 0,
  Heartbeat = 1,
  Identify = 2,
  Resume = 6,
  Reconnect = 7,
  InvalidSession = 9,
  Hello = 10,
  HeartbeatAck = 11,
}

interface GatewayPayload<T = unknown> {
  op: GatewayOp;
  d?: T;
  s?: number;
  t?: string;
}

interface HelloData {
  heartbeat_interval: number;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface QqEvent {
  id: string;
  chat_type: "c2c" | "group" | "guild";
  group_id?: string;
  channel_id?: string;
  guild_id?: string;
  author: { id: string; username?: string; bot?: boolean };
  content: string;
}

/** Minimal send-message contract (shared with existing QqApiLike). */
export interface QqApiLike {
  sendMessage(chatId: string, text: string): Promise<{ id: string }>;
}

/**
 * Full gateway contract used by QqChannel.
 * Extends QqApiLike so a QqGateway instance can replace a plain QqApiLike mock.
 */
export interface QqGatewayLike extends QqApiLike {
  readonly connected: boolean;
  connect(signal: AbortSignal): Promise<void>;
  disconnect(): Promise<void>;
  onEvent(handler: (event: QqEvent) => void): () => void;
  onGatewayError(handler: (error: Error) => void): () => void;
}

// ---------------------------------------------------------------------------
// Gateway configuration
// ---------------------------------------------------------------------------

export interface QqGatewayConfig {
  appId: string;
  clientSecret?: string;
  /** Base URL for HTTP API, e.g. "https://api.sgroup.qq.com" */
  baseUrl: string;
  /** Explicit gateway URL (bypasses GET /gateway if set). */
  gatewayUrl?: string;
  /** Gateway intents bitmask. */
  intents?: number;
}

// ---------------------------------------------------------------------------
// Concrete gateway
// ---------------------------------------------------------------------------

export class QqGateway implements QqGatewayLike {
  readonly baseUrl: string;

  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatAckTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatIntervalMs = 30000;
  private sessionId: string | null = null;
  private lastSeq: number | null = null;
  private token: string | null = null;
  private _connected = false;
  private stopping = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private maxReconnectAttempts = 10;

  private readonly eventHandlers = new Set<(event: QqEvent) => void>();
  private readonly errorHandlers = new Set<(error: Error) => void>();

  constructor(private readonly config: QqGatewayConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
  }

  // -----------------------------------------------------------------------
  // public accessors
  // -----------------------------------------------------------------------

  get connected(): boolean {
    return this._connected;
  }

  get gatewayUrl(): string | undefined {
    return this.config.gatewayUrl;
  }

  // -----------------------------------------------------------------------
  // lifecycle
  // -----------------------------------------------------------------------

  async connect(signal: AbortSignal): Promise<void> {
    if (this._connected) return;

    this.stopping = false;
    signal.addEventListener("abort", () => this.disconnect(), { once: true });

    // 1. acquire access token
    await this.acquireToken();

    // 2. determine gateway URL
    const wsUrl = await this.resolveGatewayUrl();

    // 3. open WebSocket + handshake
    await this.openSocket(wsUrl, signal);
  }

  async disconnect(): Promise<void> {
    this.stopping = true;
    this.clearTimers();
    this.closeSocket(1000, "client disconnect");
    this._connected = false;
    this.maybeFlushReconnect();
  }

  // -----------------------------------------------------------------------
  // QqApiLike – send message via HTTP
  // -----------------------------------------------------------------------

  async sendMessage(chatId: string, text: string): Promise<{ id: string }> {
    if (!this.token) throw new Error("QQ_TOKEN_UNAVAILABLE");

    const url = `${this.baseUrl}/v2/users/${chatId}/messages`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `QQBot ${this.token}`,
      },
      body: JSON.stringify({
        content: text,
        msg_type: 0,
        msg_id: "",
        msg_seq: 1,
      }),
    });

    if (!res.ok) {
      throw new Error(`QQ_SEND_FAILED: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as { id: string };
    return { id: body.id };
  }

  // -----------------------------------------------------------------------
  // event subscribers
  // -----------------------------------------------------------------------

  onEvent(handler: (event: QqEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  onGatewayError(handler: (error: Error) => void): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  // =======================================================================
  // private helpers
  // =======================================================================

  // -- token ---------------------------------------------------------------

  private async acquireToken(): Promise<void> {
    const { appId, clientSecret } = this.config;
    if (!clientSecret) throw new Error("QQ_CLIENT_SECRET_REQUIRED");

    const res = await fetch(`${this.baseUrl}/app/getAppAccessToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId, clientSecret }),
    });

    if (!res.ok) throw new Error(`QQ_AUTH_FAILED: ${res.status}`);

    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) throw new Error("QQ_TOKEN_MISSING");
    this.token = body.access_token;
  }

  // -- gateway URL ---------------------------------------------------------

  private async resolveGatewayUrl(): Promise<string> {
    if (this.config.gatewayUrl) return this.config.gatewayUrl;

    const res = await fetch(`${this.baseUrl}/gateway`, {
      headers: this.token ? { Authorization: `QQBot ${this.token}` } : {},
    });

    if (!res.ok) throw new Error(`QQ_GATEWAY_DISCOVERY_FAILED: ${res.status}`);

    const body = (await res.json()) as { url?: string };
    if (!body.url) throw new Error("QQ_GATEWAY_URL_MISSING");
    return body.url;
  }

  // -- socket lifecycle ----------------------------------------------------

  private openSocket(wsUrl: string, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error("ABORTED"));
        return;
      }

      const onAbort = () => {
        this.closeSocket(1000, "aborted");
        reject(new Error("ABORTED"));
      };
      signal.addEventListener("abort", onAbort, { once: true });

      this.closeSocket(1000, "reconnect");

      const socket = new WebSocket(wsUrl);
      this.ws = socket;

      let resolved = false;

      socket.on("open", () => {
        // Hello frame will trigger identify
      });

      socket.on("message", (raw) => {
        let payload: GatewayPayload;
        try {
          payload = JSON.parse(raw.toString()) as GatewayPayload;
        } catch {
          return; // ignore unparseable frames
        }

        this.lastSeq = payload.s ?? this.lastSeq;

        switch (payload.op) {
          case GatewayOp.Hello: {
            const hello = payload.d as HelloData;
            if (hello?.heartbeat_interval) {
              this.heartbeatIntervalMs = hello.heartbeat_interval;
            }
            this.sendIdentify();
            break;
          }

          case GatewayOp.Dispatch: {
            // Resolve connect() promise on first ready event
            if (payload.t === "READY" && !resolved) {
              resolved = true;
              signal.removeEventListener("abort", onAbort);
              const session = (payload.d as Record<string, unknown>)?.session_id;
              if (typeof session === "string") this.sessionId = session;
              this._connected = true;
              this.reconnectAttempts = 0;
              this.scheduleHeartbeat();
              resolve();
            }
            // Dispatch to handlers
            if (payload.t === "MESSAGE_CREATE" || payload.t === "AT_MESSAGE_CREATE" || payload.t === "DIRECT_MESSAGE_CREATE") {
              this.dispatchEvent(payload);
            }
            break;
          }

          case GatewayOp.HeartbeatAck: {
            this.clearHeartbeatAckTimer();
            break;
          }

          case GatewayOp.Reconnect: {
            this.scheduleReconnect("server requested reconnect");
            break;
          }

          case GatewayOp.InvalidSession: {
            this.sessionId = null;
            this.lastSeq = null;
            if (!resolved) {
              resolved = true;
              signal.removeEventListener("abort", onAbort);
              reject(new Error("QQ_INVALID_SESSION"));
            } else {
              this.scheduleReconnect("invalid session");
            }
            break;
          }
        }
      });

      socket.on("close", (code) => {
        this._connected = false;
        this.clearTimers();
        if (!resolved) {
          resolved = true;
          signal.removeEventListener("abort", onAbort);
          reject(new Error(`QQ_SOCKET_CLOSED: ${code}`));
        }
        if (!this.stopping) {
          this.scheduleReconnect(`socket closed code=${code}`);
        }
      });

      socket.on("error", (err) => {
        this.emitError(err);
        if (!resolved) {
          resolved = true;
          signal.removeEventListener("abort", onAbort);
          reject(err);
        }
      });
    });
  }

  private sendIdentify(): void {
    this.sendWs({
      op: GatewayOp.Identify,
      d: {
        token: `QQBot ${this.token}`,
        intents: this.config.intents ?? (1 << 25), // GROUP_AT_MESSAGE + DIRECT_MESSAGE
        shard: [0, 1],
        properties: {},
      },
    });
  }

  private sendResume(): void {
    if (!this.sessionId || !this.token) return;
    this.sendWs({
      op: GatewayOp.Resume,
      d: {
        token: `QQBot ${this.token}`,
        session_id: this.sessionId,
        seq: this.lastSeq ?? 0,
      },
    });
  }

  private sendHeartbeat(): void {
    // Clear any previous ACK timer before sending a new heartbeat.
    this.clearHeartbeatAckTimer();
    this.sendWs({ op: GatewayOp.Heartbeat, d: this.lastSeq ?? null });
    // Start ACK timer: if we don't get ACK within 5s, reconnect
    this.heartbeatAckTimer = setTimeout(() => {
      this.emitError(new Error("QQ_HEARTBEAT_ACK_TIMEOUT"));
      this.closeSocket(4000, "heartbeat timeout");
      this.scheduleReconnect("heartbeat ack timeout");
    }, 5000);
  }

  private scheduleHeartbeat(): void {
    this.clearHeartbeatTimer();
    // Send first heartbeat after one interval
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendHeartbeat();
      }
    }, this.heartbeatIntervalMs);
  }

  // -- reconnect -----------------------------------------------------------

  private scheduleReconnect(reason: string): void {
    if (this.stopping) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emitError(new Error(`QQ_MAX_RECONNECT: ${reason}`));
      return;
    }

    // A close event and heartbeat timeout may race; one reconnect is enough.
    if (this.reconnectTimer !== null) return;

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.stopping) return;

      try {
        // Refresh token before reconnect
        await this.acquireToken();
        const wsUrl = await this.resolveGatewayUrl();

        // If we have a session, try resume; otherwise full connect
        if (this.sessionId && this.token) {
          await this.resumeSessionOrReconnect(wsUrl);
        } else {
          await this.openSocketFull(wsUrl);
        }
      } catch (err) {
        this.emitError(err instanceof Error ? err : new Error(String(err)));
        this.scheduleReconnect("reconnect failed");
      }
    }, delay);
  }

  private resumeSessionOrReconnect(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.closeSocket(1000, "reconnect");
      const socket = new WebSocket(wsUrl);
      this.ws = socket;

      socket.on("open", () => {
        // Wait for Hello before sending Resume.
      });

      socket.on("message", (raw) => {
        let payload: GatewayPayload;
        try {
          payload = JSON.parse(raw.toString()) as GatewayPayload;
        } catch {
          return;
        }
        this.lastSeq = payload.s ?? this.lastSeq;

        if (payload.op === GatewayOp.Hello) {
          const hello = payload.d as { heartbeat_interval?: number } | undefined;
          if (hello?.heartbeat_interval) {
            this.heartbeatIntervalMs = hello.heartbeat_interval;
          }
          // Send Resume only after Hello is received.
          this.sendResume();
        } else if (payload.op === GatewayOp.Dispatch && payload.t === "RESUMED") {
          this._connected = true;
          this.reconnectAttempts = 0;
          this.scheduleHeartbeat();
          resolve();
        } else if (payload.op === GatewayOp.Dispatch && payload.t === "READY") {
          const session = (payload.d as Record<string, unknown>)?.session_id;
          if (typeof session === "string") this.sessionId = session;
          this._connected = true;
          this.reconnectAttempts = 0;
          this.scheduleHeartbeat();
          resolve();
        } else if (payload.op === GatewayOp.HeartbeatAck) {
          this.clearHeartbeatAckTimer();
        } else if (payload.op === GatewayOp.Reconnect) {
          this.scheduleReconnect("server requested reconnect");
        } else if (payload.op === GatewayOp.InvalidSession) {
          this.sessionId = null;
          this.lastSeq = null;
          if (socket.readyState === WebSocket.OPEN) {
            this.sendIdentify();
          }
        }
      });

      socket.on("close", (code) => {
        const wasConnected = this._connected;
        this._connected = false;
        this.clearTimers();
        if (!wasConnected && !this.stopping) {
          reject(new Error(`QQ_RESUME_CLOSED: ${code}`));
        } else if (!this.stopping) {
          this.scheduleReconnect(`socket closed code=${code}`);
        }
      });

      socket.on("error", (err) => {
        reject(err);
      });
    });
  }

  private async openSocketFull(wsUrl: string): Promise<void> {
    const controller = new AbortController();
    await this.openSocket(wsUrl, controller.signal);
  }

  // -- event dispatch ------------------------------------------------------

  private dispatchEvent(payload: GatewayPayload): void {
    const data = payload.d as Record<string, unknown> | undefined;
    if (!data) return;

    const author = data.author as Record<string, unknown> | undefined;
    const event: QqEvent = {
      id: String(data.id ?? ""),
      chat_type: this.inferChatType(data),
      group_id: data.group_id != null ? String(data.group_id) : undefined,
      channel_id: data.channel_id != null ? String(data.channel_id) : undefined,
      guild_id: data.guild_id != null ? String(data.guild_id) : undefined,
      author: {
        id: String(author?.id ?? ""),
        username: author?.username != null ? String(author.username) : undefined,
        bot: author?.bot != null ? Boolean(author.bot) : false,
      },
      content: typeof data.content === "string" ? data.content : "",
    };

    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }

  private inferChatType(data: Record<string, unknown>): QqEvent["chat_type"] {
    if (data.guild_id != null) return "guild";
    if (data.group_id != null) return "group";
    return "c2c";
  }

  // -- helpers -------------------------------------------------------------

  private sendWs(payload: GatewayPayload): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private closeSocket(code: number, reason: string): void {
    if (this.ws) {
      try {
        this.ws.close(code, reason);
      } catch {
        // ignore close errors
      }
      this.ws = null;
    }
  }

  private clearTimers(): void {
    this.clearHeartbeatTimer();
    this.clearHeartbeatAckTimer();
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearHeartbeatAckTimer(): void {
    if (this.heartbeatAckTimer !== null) {
      clearTimeout(this.heartbeatAckTimer);
      this.heartbeatAckTimer = null;
    }
  }

  private maybeFlushReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private emitError(err: Error): void {
    for (const handler of this.errorHandlers) {
      handler(err);
    }
  }
}
