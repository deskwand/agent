import { afterEach, describe, expect, it, vi } from "vitest";

// logger 会写文件、刷控制台，与断言无关；丢掉它让测试输出干净。
vi.mock("../../../main/utils/logger", () => ({ log: vi.fn() }));

import {
  OPENCODE_GO_PROVIDER_ID,
  OPENCODE_GO_PROVIDER_NAME,
  fetchOpenCodeGoQuota,
} from "../../../main/quota/opencode-go";

afterEach(() => vi.unstubAllGlobals());

const TOKEN = "oc_sk_test_token";

/** 一份完整的三窗口响应体。 */
function usageBody(usage: Record<string, unknown> = {}): unknown {
  return {
    usage: {
      rolling: {
        status: "ok",
        percent: 19,
        resetsAt: "2026-10-21T16:45:04.000Z",
      },
      weekly: {
        status: "ok",
        percent: 7,
        resetsAt: "2026-10-26T00:00:00.000Z",
      },
      monthly: {
        status: "ok",
        percent: 3,
        resetsAt: "2026-11-21T11:29:08.000Z",
      },
      ...usage,
    },
  };
}

function stubFetch(respond: () => Promise<Response> | Response) {
  const fetchMock = vi.fn(async () => respond());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("fetchOpenCodeGoQuota", () => {
  it("解析三个窗口：5h → 7d → 月度，percent 直通（19 不是 81），ISO 时间换算成毫秒", async () => {
    const fetchMock = stubFetch(() => Response.json(usageBody()));

    const snapshot = await fetchOpenCodeGoQuota(TOKEN);

    expect(snapshot).toEqual({
      providerId: OPENCODE_GO_PROVIDER_ID,
      providerName: OPENCODE_GO_PROVIDER_NAME,
      windows: [
        {
          kind: "session",
          usedPercent: 19,
          resetsAt: Date.parse("2026-10-21T16:45:04.000Z"),
        },
        {
          kind: "weekly",
          usedPercent: 7,
          resetsAt: Date.parse("2026-10-26T00:00:00.000Z"),
        },
        {
          kind: "monthly",
          usedPercent: 3,
          resetsAt: Date.parse("2026-11-21T11:29:08.000Z"),
        },
      ],
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://opencode.ai/inference/go/v1/usage");
    expect(init.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
      "User-Agent": "deskwand",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("超额（percent > 100）保留原值，不丢窗口也不截断", async () => {
    stubFetch(() => Response.json(usageBody({ monthly: { percent: 143 } })));

    const snapshot = await fetchOpenCodeGoQuota(TOKEN);

    expect(snapshot?.windows).toEqual([
      {
        kind: "session",
        usedPercent: 19,
        resetsAt: Date.parse("2026-10-21T16:45:04.000Z"),
      },
      {
        kind: "weekly",
        usedPercent: 7,
        resetsAt: Date.parse("2026-10-26T00:00:00.000Z"),
      },
      { kind: "monthly", usedPercent: 143 },
    ]);
  });

  it("resetsAt 缺失或无法解析时保留窗口、只丢重置时间", async () => {
    stubFetch(() =>
      Response.json(
        usageBody({
          rolling: { percent: 19, resetsAt: "not-a-date" },
          monthly: { percent: 3 },
        }),
      ),
    );

    const snapshot = await fetchOpenCodeGoQuota(TOKEN);

    expect(snapshot?.windows).toEqual([
      { kind: "session", usedPercent: 19 },
      {
        kind: "weekly",
        usedPercent: 7,
        resetsAt: Date.parse("2026-10-26T00:00:00.000Z"),
      },
      { kind: "monthly", usedPercent: 3 },
    ]);
  });

  it("缺一个窗口时只少一条", async () => {
    stubFetch(() => Response.json(usageBody({ weekly: undefined })));

    const snapshot = await fetchOpenCodeGoQuota(TOKEN);

    expect(snapshot?.windows.map((window) => window.kind)).toEqual([
      "session",
      "monthly",
    ]);
  });

  it("percent 非法的窗口被丢弃，合法窗口保留", async () => {
    stubFetch(() =>
      Response.json(
        usageBody({
          rolling: { percent: -1 },
          weekly: { percent: "7" },
        }),
      ),
    );

    const snapshot = await fetchOpenCodeGoQuota(TOKEN);

    expect(snapshot?.windows).toEqual([
      {
        kind: "monthly",
        usedPercent: 3,
        resetsAt: Date.parse("2026-11-21T11:29:08.000Z"),
      },
    ]);
  });

  it("三窗口 percent 全非法时返回 null", async () => {
    stubFetch(() =>
      Response.json(
        usageBody({
          rolling: { percent: -1 },
          weekly: { percent: Number.NaN },
          monthly: { percent: null },
        }),
      ),
    );

    await expect(fetchOpenCodeGoQuota(TOKEN)).resolves.toBeNull();
  });

  it("payload 不是对象时返回 null", async () => {
    stubFetch(() => Response.json("nope"));

    await expect(fetchOpenCodeGoQuota(TOKEN)).resolves.toBeNull();
  });

  it("非 2xx 返回 null 且不抛", async () => {
    stubFetch(() => new Response("boom", { status: 401 }));

    await expect(fetchOpenCodeGoQuota(TOKEN)).resolves.toBeNull();
  });

  it("响应不是 JSON 时返回 null", async () => {
    stubFetch(() => new Response("<html>", { status: 200 }));

    await expect(fetchOpenCodeGoQuota(TOKEN)).resolves.toBeNull();
  });

  it("网络异常（超时 / 断网）返回 null 且不抛", async () => {
    stubFetch(() => Promise.reject(new Error("timeout")));

    await expect(fetchOpenCodeGoQuota(TOKEN)).resolves.toBeNull();
  });
});
