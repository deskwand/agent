import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveProviderApiKeyMock = vi.hoisted(() => vi.fn());
const ipcHandleMock = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({ ipcMain: { handle: ipcHandleMock } }));
vi.mock("../../../main/agent/shared-model-runtime", () => ({
  resolveProviderApiKey: resolveProviderApiKeyMock,
}));
// logger 会写文件、刷控制台，与断言无关；丢掉它让测试输出干净。
// （logger 内部对 app 未定义有保护，不 mock 也不会抛，但输出会很脏）
vi.mock("../../../main/utils/logger", () => ({ log: vi.fn() }));

import {
  QUOTA_CACHE_TTL_MS,
  fetchQuotaSnapshot,
  initQuotaIpc,
  listQuotaSnapshots,
} from "../../../main/quota";

function token(accountId = "acct-1"): string {
  const payload = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": { chatgpt_account_id: accountId },
    }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}

function usageBody(): unknown {
  return {
    plan_type: "team",
    rate_limit: {
      primary_window: { used_percent: 11, reset_at: 1789759179 },
    },
  };
}

/** 时间轴：cache 用 Date.now()，测试里直接改这个可变值，避免 fake timers 与 await 互扰。 */
let now = 1_700_000_000_000;

beforeEach(() => {
  // ⚠️ `src/main/quota/index.ts` 里的 cache 是**模块级状态，会跨用例存活**（本文件只 import 一次）。
  // 每次把基线时间推进若干个 TTL，保证上一个用例写下的 fetchedAt 一定已过期；
  // 否则「取不到凭据时返回 null」会直接拿到用例 1 缓存下来的快照，而报错看起来像实现 bug。
  now += 10 * QUOTA_CACHE_TTL_MS;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  resolveProviderApiKeyMock.mockReset();
  resolveProviderApiKeyMock.mockResolvedValue(token());
  ipcHandleMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(respond: () => Promise<Response> | Response) {
  const fetchMock = vi.fn(async () => respond());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("fetchQuotaSnapshot", () => {
  it("适配器表内的 provider 返回快照", async () => {
    stubFetch(() => Response.json(usageBody()));

    const snapshot = await fetchQuotaSnapshot("openai-codex");

    expect(snapshot).toMatchObject({
      providerId: "openai-codex",
      planName: "team",
      windows: [{ kind: "session", usedPercent: 11 }],
    });
  });

  it("适配器表外的 provider 直接返回 null，不解析凭据也不打网络", async () => {
    const fetchMock = stubFetch(() => Response.json(usageBody()));

    await expect(fetchQuotaSnapshot("anthropic")).resolves.toBeNull();
    await expect(fetchQuotaSnapshot("oauth:openai-codex")).resolves.toBeNull();

    expect(resolveProviderApiKeyMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("取不到凭据时返回 null 且不打网络", async () => {
    const fetchMock = stubFetch(() => Response.json(usageBody()));
    resolveProviderApiKeyMock.mockResolvedValue(undefined);

    await expect(fetchQuotaSnapshot("openai-codex")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("凭据解析抛错时返回 null，不向上抛", async () => {
    stubFetch(() => Response.json(usageBody()));
    resolveProviderApiKeyMock.mockRejectedValue(new Error("auth store broken"));

    await expect(fetchQuotaSnapshot("openai-codex")).resolves.toBeNull();
  });

  it("TTL 内重复调用只发一次请求", async () => {
    const fetchMock = stubFetch(() => Response.json(usageBody()));

    await fetchQuotaSnapshot("openai-codex");
    now += QUOTA_CACHE_TTL_MS - 1;
    await fetchQuotaSnapshot("openai-codex");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("TTL 过期后重新请求", async () => {
    const fetchMock = stubFetch(() => Response.json(usageBody()));

    await fetchQuotaSnapshot("openai-codex");
    now += QUOTA_CACHE_TTL_MS;
    await fetchQuotaSnapshot("openai-codex");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("并发调用只发一次请求，且两个调用拿到同一结果", async () => {
    const fetchMock = stubFetch(() => Response.json(usageBody()));

    const [first, second] = await Promise.all([
      fetchQuotaSnapshot("openai-codex"),
      fetchQuotaSnapshot("openai-codex"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it("失败不写缓存：下次调用会重新请求", async () => {
    const fetchMock = stubFetch(() => new Response("boom", { status: 500 }));

    await expect(fetchQuotaSnapshot("openai-codex")).resolves.toBeNull();
    await expect(fetchQuotaSnapshot("openai-codex")).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("initQuotaIpc", () => {
  it("注册 quota.list，handler 无参数并返回快照数组", async () => {
    stubFetch(() => Response.json(usageBody()));

    initQuotaIpc();

    expect(ipcHandleMock).toHaveBeenCalledTimes(1);
    const [channel, handler] = ipcHandleMock.mock.calls[0] as unknown as [
      string,
      (event: unknown) => Promise<unknown>,
    ];
    expect(channel).toBe("quota.list");
    await expect(handler({})).resolves.toHaveLength(1);
  });
});

describe("listQuotaSnapshots", () => {
  it("没有任何可用凭据时返回空数组，且不打网络", async () => {
    const fetchMock = stubFetch(() => Response.json(usageBody()));
    resolveProviderApiKeyMock.mockResolvedValue(undefined);

    await expect(listQuotaSnapshots()).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("有凭据时返回一条快照（适配器表的键就是展示项）", async () => {
    stubFetch(() => Response.json(usageBody()));

    const snapshots = await listQuotaSnapshots();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      providerId: "openai-codex",
      planName: "team",
      windows: [{ kind: "session", usedPercent: 11 }],
    });
  });

  it("唯一通道请求失败时返回空数组，且不抛", async () => {
    stubFetch(() => new Response("boom", { status: 500 }));

    await expect(listQuotaSnapshots()).resolves.toEqual([]);
  });
});
