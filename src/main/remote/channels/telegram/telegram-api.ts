export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  is_bot?: boolean;
}

export interface TelegramSentMessage {
  message_id: number;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    text?: string;
    chat: { id: number; type: "private" | "group" | "supergroup" | "channel" };
    from?: { id: number; first_name?: string; username?: string; is_bot?: boolean };
  };
}

export interface TelegramApiLike {
  getMe(signal?: AbortSignal): Promise<TelegramUser>;
  getUpdates?(
    offset?: number,
    timeoutSeconds?: number,
    signal?: AbortSignal,
  ): Promise<TelegramUpdate[]>;
  sendMessage(
    chatId: string,
    text: string,
    replyToMessageId?: string,
    signal?: AbortSignal,
  ): Promise<TelegramSentMessage>;
  sendDocument(
    chatId: string,
    filename: string,
    data: Buffer,
    mediaType: string,
    signal?: AbortSignal,
  ): Promise<TelegramSentMessage>;
  sendChatAction(
    chatId: string,
    action: "typing",
    signal?: AbortSignal,
  ): Promise<void>;
}

export class TelegramApi implements TelegramApiLike {
  private readonly baseUrl: string;

  constructor(
    botToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  getMe(signal?: AbortSignal): Promise<TelegramUser> {
    return this.request<TelegramUser>("getMe", {}, signal);
  }

  getUpdates(
    offset?: number,
    timeoutSeconds = 25,
    signal?: AbortSignal,
  ): Promise<TelegramUpdate[]> {
    return this.request<TelegramUpdate[]>(
      "getUpdates",
      { timeout: timeoutSeconds, ...(offset === undefined ? {} : { offset }) },
      signal,
    );
  }

  sendMessage(
    chatId: string,
    text: string,
    replyToMessageId?: string,
    signal?: AbortSignal,
  ): Promise<TelegramSentMessage> {
    return this.request<TelegramSentMessage>(
      "sendMessage",
      {
        chat_id: chatId,
        text,
        ...(replyToMessageId
          ? { reply_parameters: { message_id: Number(replyToMessageId) } }
          : {}),
      },
      signal,
    );
  }

  async sendDocument(
    chatId: string,
    filename: string,
    data: Buffer,
    mediaType: string,
    signal?: AbortSignal,
  ): Promise<TelegramSentMessage> {
    const form = new FormData();
    form.set("chat_id", chatId);
    const bytes = new Uint8Array(data);
    form.set(
      "document",
      new Blob([bytes.buffer as ArrayBuffer], { type: mediaType }),
      filename,
    );
    return this.requestForm<TelegramSentMessage>("sendDocument", form, signal);
  }

  async sendChatAction(
    chatId: string,
    action: "typing",
    signal?: AbortSignal,
  ): Promise<void> {
    await this.request("sendChatAction", { chat_id: chatId, action }, signal);
  }

  private async request<T>(
    method: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const result = (await response.json()) as {
      ok: boolean;
      description?: string;
      result?: T;
    };
    if (!response.ok || !result.ok || result.result === undefined) {
      throw new Error(result.description ?? `TELEGRAM_${method}_FAILED`);
    }
    return result.result;
  }

  private async requestForm<T>(
    method: string,
    body: FormData,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}/${method}`, {
      method: "POST",
      body,
      signal,
    });
    const result = (await response.json()) as {
      ok: boolean;
      description?: string;
      result?: T;
    };
    if (!response.ok || !result.ok || result.result === undefined) {
      throw new Error(result.description ?? `TELEGRAM_${method}_FAILED`);
    }
    return result.result;
  }
}
