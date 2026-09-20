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
  STALE_FALLBACK_MAX_MS,
  clearQuotaCache,
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
  // 模块级 cache 跨用例存活，而失败回落（D）会去读它——不清的话「无凭据 / 失败 → []」
  // 那几条用例会拿到上一个用例写下的快照而变红。顺带清掉 deferred 用例残留的 inflight。
  clearQuotaCache();
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

/** 造一个能停在「在飞」状态的 fetch：每次调用都返回一个待放行的 promise。 */
function stubDeferredFetch() {
  const resolvers: Array<(value: Response) => void> = [];
  const fetchMock = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    release: (index: number) => resolvers[index](Response.json(usageBody())),
  };
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

describe("失败回落（D）", () => {
  it("刷新失败时返回上一次成功的快照，且不刷新 fetchedAt（下次仍会打网络）", async () => {
    const fetchMock = stubFetch(() => Response.json(usageBody()));

    // 第一次成功 → 写入缓存
    const first = await listQuotaSnapshots();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // TTL 过期后刷新失败
    now += QUOTA_CACHE_TTL_MS;
    fetchMock.mockImplementation(
      async () => new Response("boom", { status: 500 }),
    );
    const second = await listQuotaSnapshots();

    // 回落：仍返回上一次的快照（而不是空数组把面板塌掉）
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // 关键：失败没有刷新 fetchedAt，所以再过 TTL 会再打网络
    now += QUOTA_CACHE_TTL_MS;
    await listQuotaSnapshots();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("没有旧快照时失败仍返回空数组（降级语义不变）", async () => {
    stubFetch(() => new Response("boom", { status: 500 }));

    await expect(listQuotaSnapshots()).resolves.toEqual([]);
  });

  it("旧快照超过上限时不再回落（宁可整块不显示，也不无期限显示陈旧数据）", async () => {
    const fetchMock = stubFetch(() => Response.json(usageBody()));
    await listQuotaSnapshots();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 越过上限后再失败：不再回落到那个已经很旧的快照
    now += STALE_FALLBACK_MAX_MS;
    fetchMock.mockImplementation(
      async () => new Response("boom", { status: 500 }),
    );

    await expect(listQuotaSnapshots()).resolves.toEqual([]);
  });
});

describe("clearQuotaCache（C）", () => {
  it("清理后不再返回缓存快照（重新打网络）", async () => {
    const fetchMock = stubFetch(() => Response.json(usageBody()));

    await listQuotaSnapshots();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clearQuotaCache();
    await listQuotaSnapshots();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("拦住「清理前出发、清理后落地」的写回", async () => {
    const { fetchMock, release } = stubDeferredFetch();

    const inFlight = fetchQuotaSnapshot("openai-codex"); // A 悬空
    // ⚠️ fetch 不是同步调用的：`fetchQuotaSnapshot` 先 `await resolveProviderApiKey(...)`，
    // 所以必须等 A 真的打到 fetch，否则 `release(0)` 拿到 undefined 直接抛 TypeError。
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    clearQuotaCache();
    release(0);
    await inFlight;

    // A 的结果不应写进缓存：TTL 内再取也必须重新打网络
    const second = listQuotaSnapshots();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    release(1); // 放行 B，否则这条用例会挂到超时（而不是断言红）
    await second;
  });

  it("清空后在途表里的脏 promise 不会被复用", async () => {
    const { fetchMock, release } = stubDeferredFetch();

    const inFlight = fetchQuotaSnapshot("openai-codex"); // A 悬空
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    clearQuotaCache();

    const afterClear = fetchQuotaSnapshot("openai-codex"); // 应发起 B，而不是复用 A
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    release(0);
    release(1);
    await Promise.all([inFlight, afterClear]);
  });

  it("清理后不误删后来者的在途条目（去掉身份比对会红）", async () => {
    const { fetchMock, release } = stubDeferredFetch();

    const a = fetchQuotaSnapshot("openai-codex"); // A 悬空
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    clearQuotaCache();
    // 这两次必须**不 await**：B 还悬着，await 会自锁
    const b1 = fetchQuotaSnapshot("openai-codex");
    const b2 = fetchQuotaSnapshot("openai-codex");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // 放行 A 并等它跑完 finally —— 去掉身份比对的实现会在这里删掉 B 的条目
    release(0);
    await a;

    // 再取一次：B 若还在途，应**复用它**（而不是又发一次）。
    //
    // ⚠️ 两个坑（都实测过）：
    //  1. 不能同步断言次数：`fetch` 是 `await resolveProviderApiKey(...)` 之后才调用的，
    //     此刻 count 恒为 2（**去掉护栏时也过**），于是那条断言是惰性的，真正的红会以
    //     5s 超时的形式出现——又慢又像 flaky。必须冲刷微任务后再断言。
    //  2. 也不能用 promise 身份断言：`fetchQuotaSnapshot` 是 `async function`，
    //     每次调用都包一个新 promise，identity 恒不相等（实测 b1/b2/c 三个对象互不相等）。
    const c = fetchQuotaSnapshot("openai-codex");
    await new Promise((resolve) => setImmediate(resolve));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    release(1);
    await Promise.all([b1, b2, c]);
  });
});
