import { afterEach, describe, expect, it, vi } from "vitest";

// logger 会写文件、刷控制台，与断言无关；丢掉它让测试输出干净。
vi.mock("../../../main/utils/logger", () => ({ log: vi.fn() }));

import {
  CODEX_PROVIDER_ID,
  CODEX_PROVIDER_NAME,
  fetchCodexQuota,
} from "../../../main/quota/codex";

afterEach(() => vi.unstubAllGlobals());

/** 造一枚带 chatgpt_account_id claim 的假 JWT（三段结构即可，不验签）。 */
function token(accountId: string | null = "acct-1"): string {
  const auth = accountId === null ? {} : { chatgpt_account_id: accountId };
  const payload = Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": auth }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}

/** 一份完整的 usage 响应体。 */
function usageBody(overrides: Record<string, unknown> = {}): unknown {
  return {
    plan_type: "team",
    rate_limit: {
      primary_window: {
        used_percent: 0,
        limit_window_seconds: 18000,
        reset_at: 1789759179,
      },
      secondary_window: {
        used_percent: 51,
        limit_window_seconds: 604800,
        reset_at: 1789903190,
      },
    },
    ...overrides,
  };
}

function stubFetch(respond: () => Promise<Response> | Response) {
  const fetchMock = vi.fn(async () => respond());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("fetchCodexQuota", () => {
  it("解析两条窗口，并把 reset_at 从秒换算成毫秒", async () => {
    const fetchMock = stubFetch(() => Response.json(usageBody()));

    const snapshot = await fetchCodexQuota(token());

    expect(snapshot).toEqual({
      providerId: CODEX_PROVIDER_ID,
      providerName: CODEX_PROVIDER_NAME,
      planName: "team",
      windows: [
        { kind: "session", usedPercent: 0, resetsAt: 1789759179000 },
        { kind: "weekly", usedPercent: 51, resetsAt: 1789903190000 },
      ],
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://chatgpt.com/backend-api/wham/usage");
    expect(init.headers).toEqual({
      Authorization: `Bearer ${token()}`,
      "ChatGPT-Account-Id": "acct-1",
      Accept: "application/json",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("缺 secondary_window 时只留一条窗口", async () => {
    stubFetch(() =>
      Response.json(
        usageBody({
          rate_limit: {
            primary_window: { used_percent: 12, reset_at: 1789759179 },
          },
        }),
      ),
    );

    const snapshot = await fetchCodexQuota(token());

    expect(snapshot?.windows).toEqual([
      { kind: "session", usedPercent: 12, resetsAt: 1789759179000 },
    ]);
  });

  it("缺 primary_window 时只留一条窗口", async () => {
    stubFetch(() =>
      Response.json(
        usageBody({
          rate_limit: {
            secondary_window: { used_percent: 7, reset_at: 1789903190 },
          },
        }),
      ),
    );

    const snapshot = await fetchCodexQuota(token());

    expect(snapshot?.windows).toEqual([
      { kind: "weekly", usedPercent: 7, resetsAt: 1789903190000 },
    ]);
  });

  it("两个窗口都缺时整体返回 null", async () => {
    stubFetch(() => Response.json(usageBody({ rate_limit: {} })));

    await expect(fetchCodexQuota(token())).resolves.toBeNull();
  });

  it("used_percent 不是有限数字时该窗口被丢弃，不做强转", async () => {
    stubFetch(() =>
      Response.json(
        usageBody({
          rate_limit: {
            primary_window: { used_percent: "51" },
            secondary_window: { used_percent: Number.NaN },
          },
        }),
      ),
    );

    await expect(fetchCodexQuota(token())).resolves.toBeNull();
  });

  it("used_percent 越界时该窗口被丢弃，不做截断", async () => {
    stubFetch(() =>
      Response.json(
        usageBody({
          rate_limit: {
            primary_window: { used_percent: 150 },
            secondary_window: { used_percent: -1 },
          },
        }),
      ),
    );

    await expect(fetchCodexQuota(token())).resolves.toBeNull();
  });

  it("重置时间缺失时仍保留该窗口（只是没有 resetsAt）", async () => {
    stubFetch(() =>
      Response.json(
        usageBody({
          rate_limit: { primary_window: { used_percent: 3 } },
        }),
      ),
    );

    const snapshot = await fetchCodexQuota(token());

    expect(snapshot?.windows).toEqual([{ kind: "session", usedPercent: 3 }]);
  });

  it("缺 plan_type 时不设 planName", async () => {
    stubFetch(() => Response.json(usageBody({ plan_type: null })));

    const snapshot = await fetchCodexQuota(token());

    expect(snapshot?.planName).toBeUndefined();
    expect(snapshot?.windows).toHaveLength(2);
  });

  it("token 里没有 chatgpt_account_id 时不发请求", async () => {
    const fetchMock = stubFetch(() => Response.json(usageBody()));

    await expect(fetchCodexQuota(token(null))).resolves.toBeNull();
    await expect(fetchCodexQuota("not-a-jwt")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("非 2xx 返回 null", async () => {
    stubFetch(() => new Response("nope", { status: 401 }));

    await expect(fetchCodexQuota(token())).resolves.toBeNull();
  });

  it("响应体不是 JSON 时返回 null", async () => {
    stubFetch(() => new Response("<html>gateway</html>", { status: 200 }));

    await expect(fetchCodexQuota(token())).resolves.toBeNull();
  });

  it("fetch 抛错（网络失败/超时）时返回 null", async () => {
    stubFetch(() => {
      throw new Error("network down");
    });

    await expect(fetchCodexQuota(token())).resolves.toBeNull();
  });
});
