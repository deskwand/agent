/**
 * Discord REST — production HTTP client using fetch.
 */

export interface DiscordRestLike {
  sendMessage(
    channelId: string,
    content: string,
    replyToMessageId?: string,
  ): Promise<{ id: string }>;

  /** Fetch the gateway bot URL (used by DiscordChannel for WS connect). */
  getGatewayUrl(): Promise<string>;
}

export class DiscordRestClient implements DiscordRestLike {
  constructor(
    private readonly token: string,
    private readonly baseUrl = "https://discord.com/api/v10",
  ) {}

  async sendMessage(
    channelId: string,
    content: string,
    replyToMessageId?: string,
  ): Promise<{ id: string }> {
    const body: Record<string, unknown> = { content };
    if (replyToMessageId) {
      body.message_reference = { message_id: replyToMessageId };
    }
    const res = await fetch(`${this.baseUrl}/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`DISCORD_REST_ERROR:${res.status}:${text.slice(0, 200)}`);
    }
    return (await res.json()) as { id: string };
  }

  async getGatewayUrl(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/gateway/bot`, {
      headers: { Authorization: `Bot ${this.token}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `DISCORD_GATEWAY_URL_ERROR:${res.status}:${text.slice(0, 200)}`,
      );
    }
    const data = (await res.json()) as { url: string };
    return `${data.url}/?v=10&encoding=json`;
  }
}
