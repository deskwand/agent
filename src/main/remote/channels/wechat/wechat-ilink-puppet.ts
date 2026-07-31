import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";

export type WeChatILinkFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface WeChatILinkPuppetOptions {
  baseUrl?: string;
  fetcher?: WeChatILinkFetch;
  qrPollDelayMs?: number;
  pollRetryDelayMs?: number;
}

export interface WeChatPuppetPairingEvent {
  state: "pending" | "scanned" | "confirmed" | "expired" | "failed";
  imageUrl?: string;
  errorCode?: string;
}

interface WeChatILinkCredentials {
  token: string;
  baseUrl: string;
  accountId: string;
  userId: string;
}

interface WeChatPuppetMessage {
  id: string;
  talker: () => { id: string; name: () => string };
  room: () => { id: string; topic: () => string } | null;
  text: () => string;
  type: () => number;
  attachments?: Array<{
    id: string;
    filename?: string;
    mediaType?: string;
    sourceRef: string;
  }>;
}

interface WeChatMediaDescriptor {
  query: string;
  aesKey: Buffer;
}

interface WeChatMessageItem {
  type?: number;
  text_item?: { text?: string };
  voice_item?: { text?: string };
  file_item?: {
    file_name?: string;
    file_size?: number;
    media?: Record<string, unknown>;
    aeskey?: string;
  };
  image_item?: {
    media?: Record<string, unknown>;
    aeskey?: string;
  };
}

interface WeChatUpdate {
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  create_time_ms?: number;
  message_type?: number;
  context_token?: string;
  item_list?: WeChatMessageItem[];
}

export class WeChatILinkError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly status?: number,
  ) {
    super(message);
    this.name = "WeChatILinkError";
  }
}

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const CHANNEL_VERSION = "1.0.0";
const USER_MESSAGE_TYPE = 1;
const BOT_MESSAGE_TYPE = 2;
const FINISHED_MESSAGE_STATE = 2;
const TEXT_ITEM_TYPE = 1;
const IMAGE_ITEM_TYPE = 2;
const FILE_ITEM_TYPE = 4;
const QR_RETRY_LIMIT = 3;
const QR_POLL_DELAY_MS = 2_000;
const POLL_TIMEOUT_MS = 40_000;
const MAX_CONTEXT_TOKENS = 1_000;

export class WeChatILinkPuppet {
  private readonly fetcher: WeChatILinkFetch;
  private readonly qrPollDelayMs: number;
  private readonly pollRetryDelayMs: number;
  private baseUrl: string;
  private credentials: WeChatILinkCredentials | null = null;
  private cursor = "";
  private stopped = true;
  private lifecycleController: AbortController | null = null;
  private lifecyclePromise: Promise<void> | null = null;
  private readonly contexts = new Map<string, string>();
  private readonly mediaItems = new Map<string, WeChatMediaDescriptor>();
  private readonly downloadControllers = new Set<AbortController>();
  private readonly downloadTasks = new Set<Promise<void>>();
  private mediaInFlight = 0;
  private readonly mediaWaiters: Array<() => void> = [];
  private readonly pairingHandlers = new Set<
    (event: WeChatPuppetPairingEvent) => void
  >();
  private readonly credentialInvalidatedHandlers = new Set<() => void>();
  private readonly loginHandlers = new Set<(user: unknown) => void>();
  private readonly logoutHandlers = new Set<(user: unknown) => void>();
  private readonly messageHandlers = new Set<(message: unknown) => void>();
  private readonly errorHandlers = new Set<(error: Error) => void>();

  constructor(options: WeChatILinkPuppetOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.fetcher = options.fetcher ?? fetch;
    this.qrPollDelayMs = options.qrPollDelayMs ?? QR_POLL_DELAY_MS;
    this.pollRetryDelayMs = options.pollRetryDelayMs ?? 1_000;
  }

  get isLoggedIn(): boolean {
    return this.credentials !== null;
  }

  // -----------------------------------------------------------------------
  // New lifecycle-aware pairing & credential API
  // -----------------------------------------------------------------------

  onPairing(handler: (event: WeChatPuppetPairingEvent) => void): () => void {
    this.pairingHandlers.add(handler);
    return () => {
      this.pairingHandlers.delete(handler);
    };
  }

  onCredentialInvalidated(handler: () => void): () => void {
    this.credentialInvalidatedHandlers.add(handler);
    return () => {
      this.credentialInvalidatedHandlers.delete(handler);
    };
  }

  // -----------------------------------------------------------------------
  // Legacy handlers (keep for Channel compatibility)
  // -----------------------------------------------------------------------

  onLogin(handler: (user: unknown) => void): void {
    this.loginHandlers.add(handler);
  }

  onLogout(handler: (user: unknown) => void): void {
    this.logoutHandlers.add(handler);
  }

  onMessage(handler: (message: unknown) => void): void {
    this.messageHandlers.add(handler);
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandlers.add(handler);
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async start(token?: string): Promise<void> {
    if (this.lifecyclePromise) return;
    this.stopped = false;
    this.lifecycleController = new AbortController();
    const restored = parseCredentials(token);
    const task = restored
      ? this.runAuthenticated(restored, this.lifecycleController.signal)
      : this.runQrLogin(this.lifecycleController.signal);
    this.lifecyclePromise = task
      .catch((error: unknown) => {
        if (!isAbortError(error)) this.handleLifecycleFailure(error);
      })
      .finally(() => {
        this.lifecyclePromise = null;
        this.lifecycleController = null;
      });
    // Ensure this method returns after setup, not after QR/connected.
    await Promise.resolve();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    // Abort all in-flight CDN downloads before clearing media references
    for (const controller of this.downloadControllers) {
      controller.abort();
    }
    this.downloadControllers.clear();
    const pendingDownloads = Promise.allSettled([...this.downloadTasks]);
    const promise = this.lifecyclePromise;
    this.lifecycleController?.abort();
    await Promise.all([promise, pendingDownloads]);
    this.lifecyclePromise = null;
    this.lifecycleController = null;
    this.mediaItems.clear();
  }

  async logout(): Promise<void> {
    const user = this.credentials ? { id: this.credentials.userId } : undefined;
    await this.stop();
    this.credentials = null;
    this.cursor = "";
    this.contexts.clear();
    if (user) {
      for (const handler of this.logoutHandlers) handler(user);
    }
  }

  // -----------------------------------------------------------------------
  // Sending
  // -----------------------------------------------------------------------

  async sendText(contactId: string, text: string): Promise<{ id: string }> {
    const credentials = this.requireCredentials();
    const contextToken = this.contexts.get(contactId) ?? "";
    const result = await this.request("/ilink/bot/sendmessage", credentials, {
      msg: {
        from_user_id: "",
        to_user_id: contactId,
        client_id: randomUUID(),
        message_type: BOT_MESSAGE_TYPE,
        message_state: FINISHED_MESSAGE_STATE,
        context_token: contextToken,
        item_list: [{ type: TEXT_ITEM_TYPE, text_item: { text } }],
      },
      base_info: { channel_version: CHANNEL_VERSION },
    });
    return { id: readId(result, "message_id") ?? randomUUID() };
  }

  async sendImage(contactId: string, fileData: string): Promise<{ id: string }> {
    return this.sendMedia(contactId, fileData, IMAGE_ITEM_TYPE, "image", "image");
  }

  async sendFile(
    contactId: string,
    fileData: string,
    filename = "file",
  ): Promise<{ id: string }> {
    return this.sendMedia(contactId, fileData, FILE_ITEM_TYPE, "file", filename);
  }

  async sendChatAction(contactId: string, action: "typing"): Promise<void> {
    if (action !== "typing") return;
    await this.sendTyping(contactId);
  }

  async sendTyping(contactId: string): Promise<void> {
    const credentials = this.requireCredentials();
    const contextToken = this.contexts.get(contactId);
    if (!contextToken) return;
    const config = await this.request("/ilink/bot/getconfig", credentials, {
      ilink_user_id: contactId,
      context_token: contextToken,
      base_info: { channel_version: CHANNEL_VERSION },
    });
    const ticket = readString(config, "typing_ticket");
    if (!ticket) return;
    await this.request("/ilink/bot/sendtyping", credentials, {
      ilink_user_id: contactId,
      typing_ticket: ticket,
      status: 1,
      base_info: { channel_version: CHANNEL_VERSION },
    });
  }

  async downloadAttachment(
    sourceRef: string,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    if (this.stopped) throw new Error("ATTACHMENT_SOURCE_UNAVAILABLE");
    const media = this.mediaItems.get(sourceRef);
    if (!media) throw new Error("ATTACHMENT_SOURCE_UNAVAILABLE");

    const controller = new AbortController();
    this.downloadControllers.add(controller);
    let settleTask: (() => void) | undefined;
    const trackedTask = new Promise<void>((resolve) => {
      settleTask = resolve;
    });
    this.downloadTasks.add(trackedTask);

    const signals: AbortSignal[] = [
      controller.signal,
      AbortSignal.timeout(30_000),
    ];
    if (signal) signals.push(signal);
    const combined = AbortSignal.any(signals);

    try {
      const response = await this.fetcher(
        `https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=${encodeURIComponent(media.query)}`,
        { method: "GET", signal: combined },
      );
      if (!response.ok)
        throw new Error(`WECHAT_CDN_DOWNLOAD_FAILED:${response.status}`);

      // Reject declared Content-Length > 30 MiB before reading body
      const contentLength = response.headers.get("content-length");
      if (contentLength !== null) {
        const size = parseInt(contentLength, 10);
        if (!isNaN(size) && size > 30 * 1024 * 1024) {
          throw new Error("ATTACHMENT_TOO_LARGE");
        }
      }

      // Stream body incrementally; cancel if accumulated bytes exceed 30 MiB
      if (!response.body) throw new Error("ATTACHMENT_SOURCE_UNAVAILABLE");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let accumulated = 0;
      let exceeded = false;

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += value?.length ?? 0;
          if (accumulated > 30 * 1024 * 1024) {
            exceeded = true;
            break;
          }
          if (value) chunks.push(value);
        }
      } finally {
        reader.cancel().catch(() => {});
      }

      if (exceeded) throw new Error("ATTACHMENT_TOO_LARGE");

      const data = Buffer.concat(chunks);
      const result = decryptMedia(data, media.aesKey);
      this.mediaItems.delete(sourceRef);
      return result;
    } finally {
      this.downloadControllers.delete(controller);
      settleTask?.();
      this.downloadTasks.delete(trackedTask);
    }
  }

  async stopTyping(contactId: string): Promise<void> {
    const credentials = this.requireCredentials();
    const contextToken = this.contexts.get(contactId);
    if (!contextToken) return;
    const config = await this.request("/ilink/bot/getconfig", credentials, {
      ilink_user_id: contactId,
      context_token: contextToken,
      base_info: { channel_version: CHANNEL_VERSION },
    });
    const ticket = readString(config, "typing_ticket");
    if (!ticket) return;
    await this.request("/ilink/bot/sendtyping", credentials, {
      ilink_user_id: contactId,
      typing_ticket: ticket,
      status: 2,
      base_info: { channel_version: CHANNEL_VERSION },
    });
  }

  contactAlias(contactId: string): Promise<string> {
    return Promise.resolve(contactId);
  }

  roomTopic(roomId: string): Promise<string> {
    return Promise.resolve(roomId);
  }

  // -----------------------------------------------------------------------
  // Lifecycle stages
  // -----------------------------------------------------------------------

  private async runQrLogin(signal: AbortSignal): Promise<void> {
    for (
      let attempt = 0;
      attempt < QR_RETRY_LIMIT && !signal.aborted;
      attempt += 1
    ) {
      try {
        const qr = await this.publicRequest(
          "/ilink/bot/get_bot_qrcode?bot_type=3",
          {},
          signal,
        );
        const qrcode = readString(qr, "qrcode");
        const image = readString(qr, "qrcode_img_content");
        if (!qrcode || !image) throw new Error("WECHAT_QR_RESPONSE_INVALID");
        const imageUrl = validateQrImageUrl(image);
        this.emitPairing({ state: "pending", imageUrl });

        for (;;) {
          signal.throwIfAborted();
          const status = await this.publicRequest(
            `/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
            { "iLink-App-ClientVersion": "1" },
            signal,
          );
          const value = readString(status, "status");
          if (value === "wait") {
            await abortableDelay(this.qrPollDelayMs, signal);
            continue;
          }
          if (value === "scaned") {
            this.emitPairing({ state: "scanned", imageUrl });
            await abortableDelay(this.qrPollDelayMs, signal);
            continue;
          }
          if (value === "expired") {
            this.emitPairing({ state: "expired" });
            break;
          }
          if (value === "confirmed") {
            const credentials = parseCredentialsObject(status);
            if (!credentials) throw new Error("WECHAT_QR_CREDENTIALS_INVALID");
            this.emitPairing({ state: "confirmed" });
            return await this.runAuthenticated(credentials, signal);
          }
          throw new Error("WECHAT_QR_STATUS_INVALID");
        }
      } catch (error) {
        if (signal.aborted || isAbortError(error)) throw error;
        // Terminal: last attempt exhausted — emit exactly one failed event.
        if (attempt >= QR_RETRY_LIMIT - 1) {
          this.emitPairing({
            state: "failed",
            errorCode: toPairingErrorCode(error),
          });
          throw error;
        }
        // Retry: next iteration picks up a fresh QR.
        continue;
      }
    }
    if (!signal.aborted) {
      this.emitPairing({
        state: "failed",
        errorCode: "WECHAT_QR_LOGIN_EXPIRED",
      });
      throw new Error("WECHAT_QR_LOGIN_EXPIRED");
    }
  }

  private async runAuthenticated(
    credentials: WeChatILinkCredentials,
    signal: AbortSignal,
  ): Promise<void> {
    this.credentials = credentials;
    this.baseUrl = normalizeBaseUrl(credentials.baseUrl);
    this.emitLogin(credentials);
    await this.pollLoop(signal);
  }

  private async pollLoop(signal: AbortSignal): Promise<void> {
    let retryDelay = this.pollRetryDelayMs;
    while (!this.stopped) {
      try {
        const credentials = this.requireCredentials();
        const result = await this.request(
          "/ilink/bot/getupdates",
          credentials,
          {
            get_updates_buf: this.cursor,
            base_info: { channel_version: CHANNEL_VERSION },
          },
          AbortSignal.any([signal, AbortSignal.timeout(POLL_TIMEOUT_MS)]),
        );
        const nextCursor = readString(result, "get_updates_buf");
        if (nextCursor !== undefined) this.cursor = nextCursor;
        retryDelay = this.pollRetryDelayMs;
        for (const update of readUpdates(result)) this.dispatchUpdate(update);
      } catch (error) {
        if (this.stopped || isAbortError(error)) break;
        if (isSessionExpired(error)) {
          this.credentials = null;
          this.cursor = "";
          this.mediaItems.clear();
          for (const handler of this.credentialInvalidatedHandlers) handler();
          this.emitPairing({ state: "expired" });
          try {
            await this.runQrLogin(signal);
            // runQrLogin called runAuthenticated → new pollLoop started
            return;
          } catch (qrError) {
            if (!isAbortError(qrError) && !this.stopped) {
              this.handleLifecycleFailure(qrError);
            }
            break;
          }
        } else {
          this.emitError(toError(error));
        }
        if (signal.aborted) break;
        await abortableDelay(retryDelay, signal);
        retryDelay = Math.min(retryDelay * 2, 10_000);
      }
    }
  }

  private dispatchUpdate(update: WeChatUpdate): void {
    if (update.message_type !== USER_MESSAGE_TYPE || !update.from_user_id)
      return;
    const context = update.context_token ?? "";
    if (context) {
      if (
        this.contexts.size >= MAX_CONTEXT_TOKENS &&
        !this.contexts.has(update.from_user_id)
      ) {
        const oldest = this.contexts.keys().next().value;
        if (oldest) this.contexts.delete(oldest);
      }
      this.contexts.set(update.from_user_id, context);
    }
    const items = update.item_list ?? [];
    const messageId = String(update.message_id ?? randomUUID());
    const message: WeChatPuppetMessage = {
      id: messageId,
      talker: () => ({
        id: update.from_user_id!,
        name: () => update.from_user_id!,
      }),
      room: () => null,
      text: () => extractText(items),
      type: () => items[0]?.type ?? TEXT_ITEM_TYPE,
      attachments: items.flatMap((item, index) => {
        if (item.type === IMAGE_ITEM_TYPE || item.type === FILE_ITEM_TYPE) {
          const sourceRef = `wechat:${messageId}:${item.type === IMAGE_ITEM_TYPE ? "image" : "file"}:${index}`;
          const descriptor = describeMedia(item);
          if (descriptor) this.rememberMedia(sourceRef, descriptor);
          return [
            {
              id: `${messageId}-${item.type === IMAGE_ITEM_TYPE ? "image" : "file"}-${index}`,
              filename:
                item.type === IMAGE_ITEM_TYPE
                  ? `${messageId}.jpg`
                  : item.file_item?.file_name ?? `${messageId}.bin`,
              mediaType:
                item.type === IMAGE_ITEM_TYPE
                  ? "image/jpeg"
                  : "application/octet-stream",
              sourceRef,
            },
          ];
        }
        return [];
      }),
    };
    for (const handler of this.messageHandlers) handler(message);
  }

  // -----------------------------------------------------------------------
  // Media upload
  // -----------------------------------------------------------------------

  private async sendMedia(
    contactId: string,
    fileData: string,
    itemType: number,
    kind: "image" | "file",
    filename: string,
  ): Promise<{ id: string }> {
    if (!fileData) throw new Error("WECHAT_MEDIA_DATA_EMPTY");
    const data = Buffer.from(fileData, "base64");
    if (data.length > 30 * 1024 * 1024) {
      throw new Error("WECHAT_ATTACHMENT_TOO_LARGE");
    }

    const credentials = this.requireCredentials();
    await this.acquireMediaSlot();
    try {
      return await this.uploadAndSendMedia(
        credentials,
        contactId,
        data,
        itemType,
        kind,
        filename,
      );
    } finally {
      this.releaseMediaSlot();
    }
  }

  private async uploadAndSendMedia(
    credentials: WeChatILinkCredentials,
    contactId: string,
    data: Buffer,
    itemType: number,
    kind: "image" | "file",
    filename: string,
  ): Promise<{ id: string }> {
    const aesKey = randomBytes(16);
    const fileKey = randomBytes(16).toString("hex");
    const encrypted = encryptMedia(data, aesKey);
    const upload = await this.request("/ilink/bot/getuploadurl", credentials, {
      filekey: fileKey,
      media_type: kind === "image" ? 1 : 3,
      to_user_id: contactId,
      rawsize: data.length,
      rawfilemd5: createHash("md5").update(data).digest("hex"),
      filesize: encrypted.length,
      no_need_thumb: true,
      aeskey: aesKey.toString("hex"),
      base_info: { channel_version: CHANNEL_VERSION },
    });
    const uploadParam = readString(upload, "upload_param");
    if (!uploadParam) throw new Error("WECHAT_UPLOAD_URL_MISSING");

    const cdnResponse = await this.fetcher(
      `https://novac2c.cdn.weixin.qq.com/c2c/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(fileKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: new Uint8Array(encrypted),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!cdnResponse.ok)
      throw new Error(`WECHAT_CDN_UPLOAD_FAILED:${cdnResponse.status}`);
    const encryptedParam = cdnResponse.headers.get("x-encrypted-param");
    if (!encryptedParam) throw new Error("WECHAT_CDN_PARAM_MISSING");

    const media = {
      encrypt_query_param: encryptedParam,
      aes_key: aesKey.toString("base64"),
      encrypt_type: 1,
    };
    const item =
      kind === "image"
        ? { type: itemType, image_item: { media, mid_size: encrypted.length } }
        : {
            type: itemType,
            file_item: { media, file_name: filename, file_size: data.length },
          };
    const result = await this.request("/ilink/bot/sendmessage", credentials, {
      msg: {
        from_user_id: "",
        to_user_id: contactId,
        client_id: randomUUID(),
        message_type: BOT_MESSAGE_TYPE,
        message_state: FINISHED_MESSAGE_STATE,
        context_token: this.contexts.get(contactId) ?? "",
        item_list: [item],
      },
      base_info: { channel_version: CHANNEL_VERSION },
    });
    return { id: readId(result, "message_id") ?? randomUUID() };
  }

  private rememberMedia(
    sourceRef: string,
    media: WeChatMediaDescriptor,
  ): void {
    if (!this.mediaItems.has(sourceRef) && this.mediaItems.size >= 1000) {
      const oldest = this.mediaItems.keys().next().value;
      if (oldest !== undefined) this.mediaItems.delete(oldest);
    }
    this.mediaItems.set(sourceRef, media);
  }

  private acquireMediaSlot(): Promise<void> {
    if (this.mediaInFlight < 4) {
      this.mediaInFlight += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) =>
      this.mediaWaiters.push(() => {
        this.mediaInFlight += 1;
        resolve();
      }),
    );
  }

  private releaseMediaSlot(): void {
    this.mediaInFlight -= 1;
    this.mediaWaiters.shift()?.();
  }

  private requireCredentials(): WeChatILinkCredentials {
    if (!this.credentials) throw new Error("WECHAT_NOT_LOGGED_IN");
    return this.credentials;
  }

  // -----------------------------------------------------------------------
  // HTTP helpers
  // -----------------------------------------------------------------------

  private async publicRequest(
    path: string,
    extraHeaders: Record<string, string> = {},
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const timeout = AbortSignal.timeout(15_000);
    const combined = signal
      ? AbortSignal.any([signal, timeout])
      : timeout;
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: extraHeaders,
      signal: combined,
    });
    return parseResponse(response);
  }

  private async request(
    path: string,
    credentials: WeChatILinkCredentials,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const response = await this.fetcher(
      `${normalizeBaseUrl(credentials.baseUrl)}${path}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          AuthorizationType: "ilink_bot_token",
          Authorization: `Bearer ${credentials.token}`,
          "X-WECHAT-UIN": createUin(),
        },
        body: JSON.stringify(body),
        signal: signal ?? AbortSignal.timeout(15_000),
      },
    );
    return parseResponse(response);
  }

  // -----------------------------------------------------------------------
  // Event emission
  // -----------------------------------------------------------------------

  private emitPairing(event: WeChatPuppetPairingEvent): void {
    for (const handler of this.pairingHandlers) handler(event);
  }

  private emitLogin(credentials: WeChatILinkCredentials): void {
    const user = { id: credentials.userId, token: JSON.stringify(credentials) };
    for (const handler of this.loginHandlers) handler(user);
  }

  private emitError(error: Error): void {
    for (const handler of this.errorHandlers) handler(error);
  }

  private handleLifecycleFailure(error: unknown): void {
    this.emitError(toError(error));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted)
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function validateQrImageUrl(value: string): string {
  if (/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))
    return value;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:") return value;
  } catch {
    // fall through to error
  }
  throw new Error("WECHAT_QR_IMAGE_INVALID");
}

function parseCredentials(
  value: string | undefined,
): WeChatILinkCredentials | null {
  if (!value) return null;
  try {
    return parseCredentialsObject(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function parseCredentialsObject(
  value: unknown,
): WeChatILinkCredentials | null {
  if (!isRecord(value)) return null;
  const token = readString(value, "bot_token") ?? readString(value, "token");
  const baseUrl =
    readString(value, "baseurl") ?? readString(value, "baseUrl");
  const accountId =
    readString(value, "ilink_bot_id") ?? readString(value, "accountId");
  const userId =
    readString(value, "ilink_user_id") ?? readString(value, "userId");
  if (!token || !baseUrl || !accountId || !userId) return null;
  return { token, baseUrl, accountId, userId };
}

function readUpdates(value: Record<string, unknown>): WeChatUpdate[] {
  return Array.isArray(value.msgs) ? value.msgs.filter(isWeChatUpdate) : [];
}

function isWeChatUpdate(value: unknown): value is WeChatUpdate {
  return isRecord(value);
}

function extractText(items: WeChatMessageItem[]): string {
  return items
    .map((item) => {
      if (item.type === TEXT_ITEM_TYPE) return item.text_item?.text ?? "";
      if (item.type === 3) return item.voice_item?.text ?? "[voice]";
      if (item.type === FILE_ITEM_TYPE) return "";
      if (item.type === IMAGE_ITEM_TYPE) return "";
      return "";
    })
    .filter((text) => text.length > 0)
    .join("\n");
}

async function parseResponse(
  response: Response,
): Promise<Record<string, unknown>> {
  const text = await response.text();
  const raw = parseJsonRecord(text);
  if (!response.ok) {
    throw new WeChatILinkError(
      readOptionalString(raw, "errmsg") ??
        `WECHAT_ILINK_HTTP_${response.status}`,
      readNumericCode(raw),
      response.status,
    );
  }
  if (!raw) throw new Error("WECHAT_ILINK_RESPONSE_INVALID");
  const code = readNumericCode(raw);
  if (code !== undefined && code !== 0) {
    throw new WeChatILinkError(
      readString(raw, "errmsg") ?? "WECHAT_ILINK_API_ERROR",
      code,
      response.status,
    );
  }
  return raw;
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function readNumericCode(
  value: Record<string, unknown> | null,
): number | undefined {
  if (!value) return undefined;
  if (typeof value.errcode === "number") return value.errcode;
  return typeof value.ret === "number" ? value.ret : undefined;
}

function readOptionalString(
  value: Record<string, unknown> | null,
  key: string,
): string | undefined {
  return value && typeof value[key] === "string" ? value[key] : undefined;
}

function readString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  return typeof value[key] === "string" ? value[key] : undefined;
}

function readId(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const raw = value[key];
  return typeof raw === "string" || typeof raw === "number"
    ? String(raw)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function encryptMedia(data: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

function decryptMedia(data: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function describeMedia(
  item: WeChatMessageItem,
): WeChatMediaDescriptor | null {
  const media =
    item.type === IMAGE_ITEM_TYPE
      ? item.image_item?.media
      : item.file_item?.media;
  if (!media || typeof media.encrypt_query_param !== "string") return null;
  const key =
    item.type === IMAGE_ITEM_TYPE
      ? item.image_item?.aeskey
      : item.file_item?.aeskey;
  const encodedKey =
    typeof key === "string"
      ? key
      : typeof media.aes_key === "string"
        ? media.aes_key
        : undefined;
  const aesKey = encodedKey
    ? parseAesKey(encodedKey, key !== undefined)
    : null;
  return aesKey ? { query: media.encrypt_query_param, aesKey } : null;
}

function parseAesKey(value: string, hex: boolean): Buffer | null {
  if (hex) {
    const result = Buffer.from(value, "hex");
    return result.length === 16 ? result : null;
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 16) return decoded;
  if (
    decoded.length === 32 &&
    /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))
  ) {
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  return null;
}

function createUin(): string {
  return randomBytes(4).toString("base64");
}

function toPairingErrorCode(error: unknown): string {
  if (error instanceof WeChatILinkError) {
    if (error.status !== undefined) return `WECHAT_ILINK_HTTP_${error.status}`;
    return "WECHAT_QR_API_FAILED";
  }
  if (error instanceof Error) {
    if (error.name === "TimeoutError") return "WECHAT_QR_REQUEST_TIMEOUT";
    if (/^WECHAT_QR_[A-Z0-9_]+$/.test(error.message)) return error.message;
  }
  return "WECHAT_QR_LOGIN_FAILED";
}

function isSessionExpired(error: unknown): boolean {
  return error instanceof WeChatILinkError && error.code === -14;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
