import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeishuAPI } from "../feishu-api";

const API_BASE = "https://open.feishu.cn/open-apis";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("FeishuAPI", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createApi(): FeishuAPI {
    return new FeishuAPI("app-id", "app-secret");
  }

  it("refreshes and caches the tenant access token", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ code: 0, tenant_access_token: "token-1", expire: 7200 }),
    );
    const api = createApi();

    const token = await api.refreshToken();
    expect(token).toBe("token-1");

    // Second call uses the cache (no extra fetch).
    const token2 = await api.refreshToken();
    expect(token2).toBe("token-1");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      `${API_BASE}/auth/v3/tenant_access_token/internal`,
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"app_id":"app-id"'),
      }),
    );
  });

  it("deduplicates concurrent token refreshes", async () => {
    let resolve!: (value: Response) => void;
    fetchSpy.mockReturnValueOnce(
      new Promise<Response>((r) => {
        resolve = r;
      }),
    );
    const api = createApi();

    const first = api.refreshToken();
    const second = api.refreshToken();
    resolve(
      jsonResponse({ code: 0, tenant_access_token: "token-x", expire: 7200 }),
    );

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe("token-x");
    expect(b).toBe("token-x");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws on non-zero API code", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ code: 99991663, msg: "invalid app secret" }),
    );
    const api = createApi();

    await expect(api.refreshToken()).rejects.toThrow(
      "Failed to get access token",
    );
  });

  it("throws on HTTP error", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("nope", { status: 500, statusText: "Internal Server Error" }),
    );
    const api = createApi();

    await expect(api.refreshToken()).rejects.toThrow("HTTP 500");
  });

  it("gets bot info with the access token", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          tenant_access_token: "token-bot",
          expire: 7200,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          bot: { open_id: "ou_123", app_name: "Test Bot" },
        }),
      );
    const api = createApi();

    const info = await api.getBotInfo();
    expect(info).toEqual({ open_id: "ou_123", app_name: "Test Bot" });
    expect(fetchSpy).toHaveBeenCalledWith(
      `${API_BASE}/bot/v3/info`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-bot",
        }),
      }),
    );
  });

  it("sends a message and returns message_id", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          tenant_access_token: "token-send",
          expire: 7200,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: { message_id: "om_42" },
        }),
      );
    const api = createApi();

    const result = await api.sendMessage(
      "oc_chat",
      "text",
      { text: "hello" },
      "reply-to-id",
    );
    expect(result).toBe("om_42");
    // replyMessageId routes to the reply endpoint.
    expect(fetchSpy).toHaveBeenLastCalledWith(
      `${API_BASE}/im/v1/messages/reply-to-id/reply`,
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"msg_type":"text"'),
      }),
    );
  });

  it("sends a new message to chat_id endpoint", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          tenant_access_token: "token-send2",
          expire: 7200,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: { message_id: "om_43" },
        }),
      );
    const api = createApi();

    const result = await api.sendMessage("oc_chat", "text", { text: "hi" });
    expect(result).toBe("om_43");
    expect(fetchSpy).toHaveBeenLastCalledWith(
      `${API_BASE}/im/v1/messages?receive_id_type=chat_id`,
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"receive_id":"oc_chat"'),
      }),
    );
  });
});
