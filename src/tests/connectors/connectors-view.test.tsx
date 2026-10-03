// @vitest-environment jsdom
/**
 * ConnectorsView 的回归测试：授权中必须能取消。
 *
 * **为什么要有这一层**：`addCatalogServer` / `authorize` 会一路等到用户在浏览器里
 * 点完「批准」（默认超时 5 分钟）。之前视图只在 `await` 返回后才刷新，于是这段
 * 时间里卡片还画着「连接」—— 用户既看不到「授权中」，也没有任何按钮能中止。
 * 这里渲染真实的 View + Card，用受控（deferred）的 IPC 把「等待期」摊开，
 * 守住那段时间里可达的按钮与状态。
 *
 * 辅助的「技能 / 插件」子视图按惯例 mock 掉（本用例从不切到那两个 tab，
 * 但模块加载仍会 import 它们）。i18n 同样整模块 mock：`t(key) => key`。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectorsView } from "../../renderer/components/connectors/ConnectorsView";
import type {
  ActionResult,
  ConnectorEntry,
  ConnectorInstance,
  ConnectorStatus,
} from "../../shared/connectors";

const api = vi.hoisted(() => {
  const connectors = {
    list: vi.fn(),
    addCatalogServer: vi.fn(),
    connectWithKey: vi.fn(),
    authorize: vi.fn(),
    cancelSignIn: vi.fn(),
    removeServer: vi.fn(),
    setEnabled: vi.fn(),
    addCustomServer: vi.fn(),
    onStatusChanged: vi.fn(),
  };
  // ConnectorsView 在**模块作用域**读 window.electronAPI 决定 isElectron，
  // 所以它必须在 import 之前就存在 —— 否则整个视图静默退化成空壳。
  (window as unknown as { electronAPI: unknown }).electronAPI = { connectors };
  return connectors;
});

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../renderer/components/settings/SettingsSkills", () => ({
  SettingsSkills: () => null,
}));

vi.mock("../../renderer/components/PiExtensionManagerView", () => ({
  PiExtensionManagerView: () => null,
}));

const CONNECT = "connectors.action.connect";
const REAUTHORIZE = "connectors.action.reauthorize";
const DISCONNECT = "connectors.action.disconnect";
const CANCEL = "connectors.action.cancel";
const CONNECT_FAILED = "connectors.connectFailed";

let container: HTMLDivElement;
let root: Root;
let entries: ConnectorEntry[];

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function instance(status: ConnectorStatus): ConnectorInstance {
  return {
    id: "notion",
    label: "notion",
    status,
    summary: "connectors.summary.remote",
  };
}

/** 目录卡片：`instances` 为空就是「还没添加」，点了会走 addCatalogServer。 */
function notion(instances: ConnectorInstance[] = []): ConnectorEntry {
  return {
    key: "mcp:catalog:notion",
    serverName: "notion",
    source: "mcp-remote",
    transport: "http",
    nameKey: "connectors.catalog.notion",
    descriptionKey: "connectors.catalog.notionDesc",
    instances,
  };
}

function catalogEntry(
  key: string,
  category: ConnectorEntry["category"],
  instances: ConnectorInstance[] = [],
): ConnectorEntry {
  return {
    key: `mcp:catalog:${key}`,
    serverName: key,
    source: "mcp-remote",
    transport: "http",
    nameKey: `connectors.catalog.${key}`,
    descriptionKey: `connectors.catalog.${key}Desc`,
    category,
    instances,
  };
}

function customEntry(name: string): ConnectorEntry {
  return {
    key: `mcp:server:${name}`,
    serverName: name,
    source: "mcp-custom",
    transport: "stdio",
    nameKey: name,
    instances: [instance({ kind: "off" })],
  };
}

function builtinEntry(name = "GUI_Operate"): ConnectorEntry {
  return {
    key: `mcp:builtin:${name}`,
    serverName: name,
    source: "mcp-builtin",
    transport: "stdio",
    nameKey: "connectors.builtin.computerUse",
    descriptionKey: "connectors.builtin.computerUseDesc",
    instances: [
      {
        id: name,
        label: name,
        status: { kind: "off" },
        summary: "connectors.summary.local",
      },
    ],
  };
}

async function clickChip(category: string): Promise<void> {
  const chip = [
    ...container.querySelectorAll('[data-testid="category-chip"]'),
  ].find(
    (c) => (c.getAttribute("data-category") ?? "") === category,
  ) as HTMLElement;
  await act(async () => {
    chip.click();
  });
}

function byKey(key: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(key),
  );
}

/** 「已接入」开关。 */
function addedFilter(): HTMLButtonElement {
  return container.querySelector(
    '[data-testid="added-filter"]',
  ) as HTMLButtonElement;
}

/** 卡片数：头像每个卡片恰好一个（卡片根节点没有 testid）。 */
function cardCount(): number {
  return container.querySelectorAll('[data-testid="card-avatar"]').length;
}

/** 分类 chip 标签末尾的数字。 */
function chipCount(category: string): string | undefined {
  const chip = container.querySelector(
    `[data-testid="category-chip"][data-category="${category}"]`,
  );
  return chip?.textContent?.match(/\d+$/)?.[0];
}

/** 开关上的数字。 */
function addedCount(): string | undefined {
  return addedFilter().textContent?.match(/\d+$/)?.[0];
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  vi.clearAllMocks();
  entries = [notion()];
  api.list.mockImplementation(async () => entries);
  api.onStatusChanged.mockImplementation(() => () => undefined);
  api.cancelSignIn.mockResolvedValue({ ok: true });
  api.removeServer.mockResolvedValue({ ok: true });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount(): Promise<void> {
  await act(async () => {
    root.render(<ConnectorsView />);
  });
}

describe("连接期间的可取消性", () => {
  it("点「连接」后授权没回来也能立刻取消，取消传 serverName", async () => {
    const signIn = deferred<ActionResult>();
    api.addCatalogServer.mockReturnValue(signIn.promise);

    await mount();
    await act(async () => {
      byKey(CONNECT)!.click();
    });

    expect(api.addCatalogServer).toHaveBeenCalledWith("notion");
    // 未添加的条目此时还没有实例，但必须已经显示「授权中」并给出取消
    expect(container.textContent).toContain("connectors.status.connecting");
    const cancel = byKey(CANCEL);
    expect(cancel).toBeDefined();

    await act(async () => {
      cancel!.click();
    });
    // registry 按 mcp.json 里的 server 名查授权表 —— 没有实例时用 serverName
    expect(api.cancelSignIn).toHaveBeenCalledWith("notion");

    // 旧流程还没 settle：不能马上允许重新授权，否则两个回调服务器会打架
    expect(byKey(CONNECT)).toBeUndefined();

    await act(async () => {
      signIn.resolve({ ok: false, cancelled: true });
    });
    // 用户主动取消不是失败：不能冒出红条
    expect(container.textContent).not.toContain(CONNECT_FAILED);
    expect(byKey(CONNECT)).toBeDefined();
  });

  it("重新授权（needs-auth）时同样能立刻取消", async () => {
    entries = [notion([instance({ kind: "needs-auth" })])];
    const signIn = deferred<ActionResult>();
    api.authorize.mockReturnValue(signIn.promise);

    await mount();
    await act(async () => {
      byKey(REAUTHORIZE)!.click();
    });

    expect(api.authorize).toHaveBeenCalledWith("notion");
    const cancel = byKey(CANCEL);
    expect(cancel).toBeDefined();
    await act(async () => {
      cancel!.click();
    });
    expect(api.cancelSignIn).toHaveBeenCalledWith("notion");

    await act(async () => {
      signIn.resolve({ ok: false, cancelled: true });
    });
    expect(container.textContent).not.toContain(CONNECT_FAILED);
  });

  it("本地授权中优先于传输状态显示", async () => {
    // idle 卡片平时只显示「连接 + 断开」；授权期间必须变成「授权中 + 取消」。
    entries = [notion([instance({ kind: "idle" })])];
    const signIn = deferred<ActionResult>();
    api.authorize.mockReturnValue(signIn.promise);

    await mount();
    await act(async () => {
      byKey(CONNECT)!.click();
    });

    expect(container.textContent).toContain("connectors.status.connecting");
    expect(byKey(CANCEL)).toBeDefined();
    // 已有实例时退路照旧保留
    expect(byKey(DISCONNECT)).toBeDefined();

    await act(async () => {
      signIn.resolve({ ok: false, cancelled: true });
    });
  });
});

describe("重复点击", () => {
  it("授权还没回来时再点不会发起第二次 IPC", async () => {
    const signIn = deferred<ActionResult>();
    api.addCatalogServer.mockReturnValue(signIn.promise);

    await mount();
    await act(async () => {
      byKey(CONNECT)!.click();
    });
    await act(async () => {
      byKey(CONNECT)?.click();
    });

    expect(api.addCatalogServer).toHaveBeenCalledTimes(1);
    await act(async () => {
      signIn.resolve({ ok: true });
    });
  });

  it("同一个事件里连点两次也只发一次 IPC（state 还没落地）", async () => {
    const signIn = deferred<ActionResult>();
    api.addCatalogServer.mockReturnValue(signIn.promise);

    await mount();
    await act(async () => {
      const btn = byKey(CONNECT)!;
      btn.click();
      btn.click();
    });

    expect(api.addCatalogServer).toHaveBeenCalledTimes(1);
    await act(async () => {
      signIn.resolve({ ok: true });
    });
  });
});

describe("传输层的 connecting 不是授权", () => {
  it("只留「断开」，绝不调 signIn 的取消", async () => {
    entries = [notion([instance({ kind: "connecting" })])];

    await mount();
    expect(byKey(CANCEL)).toBeUndefined();
    const disconnect = byKey(DISCONNECT);
    expect(disconnect).toBeDefined();

    await act(async () => {
      disconnect!.click();
    });
    // 本地没有在等授权 —— cancelSignIn 找不到东西可中止，不该乱调
    expect(api.cancelSignIn).not.toHaveBeenCalled();
    expect(api.removeServer).toHaveBeenCalledWith("notion");
  });
});

describe("授权中断开", () => {
  it("先取消再删除，旧流程结束后的失败不弹红条", async () => {
    entries = [notion([instance({ kind: "idle" })])];
    const signIn = deferred<ActionResult>();
    api.authorize.mockReturnValue(signIn.promise);

    await mount();
    await act(async () => {
      byKey(CONNECT)!.click();
    });

    // 删除后列表里不该再有这个实例
    entries = [notion()];
    await act(async () => {
      byKey(DISCONNECT)!.click();
    });
    expect(api.cancelSignIn).toHaveBeenCalledWith("notion");
    expect(api.removeServer).toHaveBeenCalledWith("notion");
    // 删除完成不意味着旧授权结束；在它 settle 前仍不允许启动新流程。
    expect(byKey(CONNECT)).toBeUndefined();

    // 旧流程随后以失败收尾 —— 是断开导致的，用户不该看到一个红条
    await act(async () => {
      signIn.resolve({ ok: false, error: "boom" });
    });
    expect(container.textContent).not.toContain(CONNECT_FAILED);
  });
});

describe("「添加」接线", () => {
  /** 弹窗里的确认按钮 —— 页头那个「添加」文案相同，必须限定在弹窗内找。 */
  function confirmButton(): HTMLButtonElement {
    const dialog = container
      .querySelector('[data-testid="add-payload"]')!
      .closest(".card") as HTMLElement;
    return [...dialog.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("connectors.action.add"),
    ) as HTMLButtonElement;
  }

  function typePayload(value: string): void {
    const box = container.querySelector(
      '[data-testid="add-payload"]',
    ) as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setter.call(box, value);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("点「添加」打开弹窗，成功后重新拉列表", async () => {
    api.addCustomServer.mockResolvedValue({ ok: true });
    await mount();
    expect(container.querySelector('[data-testid="add-payload"]')).toBeNull();

    await act(async () => byKey("connectors.action.add")!.click());
    expect(
      container.querySelector('[data-testid="add-payload"]'),
    ).not.toBeNull();

    const listCallsBefore = api.list.mock.calls.length;
    typePayload('{"mcpServers":{"my-tools":{"command":"npx"}}}');
    await act(async () => confirmButton().click());

    expect(api.addCustomServer).toHaveBeenCalledTimes(1);
    // onAdded 必须真的去刷新 —— 「加上了但列表没变」是这类接线最容易漏的回归
    expect(api.list.mock.calls.length).toBeGreaterThan(listCallsBefore);
    expect(container.querySelector('[data-testid="add-payload"]')).toBeNull();
  });
});

describe("按分类分段与筛选", () => {
  it("groups cards by category, in CATEGORY_ORDER", async () => {
    entries = [catalogEntry("notion", "collab"), catalogEntry("sentry", "dev")];
    await mount();
    const titles = [
      ...container.querySelectorAll('[data-testid="section-title"]'),
    ].map((e) => e.textContent);
    expect(titles).toHaveLength(2);
    // 段序由 CATEGORY_ORDER 决定：dev 在 collab 之前，而不是按 entries 的传入顺序
    expect(titles[0]).toContain("connectors.category.dev");
    expect(titles[1]).toContain("connectors.category.collab");
  });

  it("does not render a section for a category with no entries", async () => {
    entries = [catalogEntry("notion", "collab")];
    await mount();
    const titles = [
      ...container.querySelectorAll('[data-testid="section-title"]'),
    ].map((e) => e.textContent);
    expect(titles).toHaveLength(1);
    expect(titles[0]).toContain("connectors.category.collab");
  });

  it("renders the custom section and its chip only when the user has their own servers", async () => {
    entries = [catalogEntry("notion", "collab")];
    await mount();
    expect(container.textContent).not.toContain("connectors.category.other");
    expect(container.querySelector('[data-category="other"]')).toBeNull();

    entries = [catalogEntry("notion", "collab"), customEntry("qmd-tools")];
    await mount();
    expect(container.textContent).toContain("connectors.category.other");
    expect(container.querySelector('[data-category="other"]')).not.toBeNull();
  });

  it("filters to one category when its chip is clicked", async () => {
    entries = [catalogEntry("notion", "collab"), catalogEntry("sentry", "dev")];
    await mount();
    await clickChip("dev");
    expect(container.textContent).toContain("connectors.catalog.sentry");
    expect(container.textContent).not.toContain("connectors.catalog.notion");
  });

  it("goes back to every section when the all chip is clicked", async () => {
    entries = [catalogEntry("notion", "collab"), catalogEntry("sentry", "dev")];
    await mount();
    await clickChip("dev");
    expect(container.textContent).not.toContain("connectors.catalog.notion");
    await clickChip("all");
    expect(container.textContent).toContain("connectors.catalog.notion");
    expect(container.textContent).toContain("connectors.catalog.sentry");
  });

  it("falls back to all when the selected category disappears", async () => {
    entries = [catalogEntry("notion", "collab"), customEntry("qmd-tools")];
    await mount();
    await clickChip("other");
    expect(container.textContent).not.toContain("connectors.catalog.notion");

    entries = [catalogEntry("notion", "collab")];
    await mount();
    expect(container.textContent).toContain("connectors.catalog.notion");
  });

  it("keeps the add button inside the sticky toolbar", async () => {
    entries = [catalogEntry("notion", "collab")];
    await mount();
    const toolbar = container.querySelector('[data-testid="catalog-toolbar"]')!;
    expect(toolbar.textContent).toContain("connectors.action.add");
  });

  it("never renders built-in capabilities on the connectors page", async () => {
    // 它们住在设置的「能力」里 —— 这一页只装外部服务。
    entries = [catalogEntry("notion", "collab"), builtinEntry()];
    await mount();
    expect(container.textContent).toContain("connectors.catalog.notion");
    expect(container.textContent).not.toContain(
      "connectors.builtin.computerUse",
    );
  });

  it("excludes built-in capabilities from the all chip count", async () => {
    entries = [catalogEntry("notion", "collab"), builtinEntry()];
    await mount();
    const all = container.querySelector('[data-category="all"]')!;
    expect(all.textContent).toContain("1");
    expect(all.textContent).not.toContain("2");
  });
});

/** key 型目录条目：凭据走对话框，不走 OAuth。 */
function keyCatalogEntry(
  key: string,
  instances: ConnectorInstance[] = [],
): ConnectorEntry {
  return {
    key: `mcp:catalog:${key}`,
    serverName: key,
    source: "mcp-remote",
    transport: "http",
    nameKey: `connectors.catalog.${key}`,
    descriptionKey: `connectors.catalog.${key}Desc`,
    category: "dev",
    auth: {
      kind: "key",
      placement: "header",
      name: "Authorization",
      valuePrefix: "Bearer ",
      consoleUrl: "https://example.com/console",
      credentialLabelKey: `connectors.catalog.${key}Credential`,
    },
    instances,
  };
}

describe("key 型条目：弹框填凭据，绝不走 OAuth", () => {
  it("「连接」开输入框，提交走 connectWithKey，不碰 addCatalogServer", async () => {
    entries = [keyCatalogEntry("gitee")];
    api.connectWithKey.mockResolvedValue({ ok: true });
    await mount();

    await act(async () => {
      byKey(CONNECT)!.click();
    });
    const box = container.querySelector(
      '[data-testid="key-credential"]',
    ) as HTMLInputElement;
    expect(box).not.toBeNull();
    // 这条路径上没有浏览器要开：走去 addCatalogServer 会拉起授权回调服务器
    expect(api.addCatalogServer).not.toHaveBeenCalled();

    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(box, "tok-123");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((b) =>
          (b.textContent ?? "").includes("connectors.keyDialog.submit"),
        )!
        .click();
    });

    expect(api.connectWithKey).toHaveBeenCalledWith("gitee", "tok-123");
    expect(api.authorize).not.toHaveBeenCalled();
  });

  it("已添加但 idle 时，重试也是填凭据而不是重新授权", async () => {
    entries = [keyCatalogEntry("gitee", [instance({ kind: "idle" })])];
    await mount();

    await act(async () => {
      byKey(CONNECT)!.click();
    });

    // 「重新授权」会去调 signIn，对着一个不需要授权的端点只会报错
    expect(api.authorize).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="key-credential"]'),
    ).not.toBeNull();
  });

  it("OAuth 条目的「连接」仍然走浏览器授权，不弹框", async () => {
    entries = [notion()];
    const signIn = deferred<ActionResult>();
    api.addCatalogServer.mockReturnValue(signIn.promise);
    await mount();

    await act(async () => {
      byKey(CONNECT)!.click();
    });

    expect(api.addCatalogServer).toHaveBeenCalledWith("notion");
    expect(
      container.querySelector('[data-testid="key-credential"]'),
    ).toBeNull();
    await act(async () => {
      signIn.resolve({ ok: true });
    });
  });
});

describe("已接入筛选", () => {
  it("默认不筛选：未接入的目录条目照样渲染", async () => {
    entries = [
      catalogEntry("notion", "collab", [instance({ kind: "ready" })]),
      catalogEntry("sentry", "dev"),
    ];

    await mount();

    expect(cardCount()).toBe(2);
    expect(chipCount("all")).toBe("2");
    expect(addedFilter().getAttribute("aria-pressed")).toBe("false");
    expect(addedCount()).toBe("1");
    // F1：开关在工具栏里、排在「添加」之前 —— 它不是分类 chip 那一排的一员
    const add = byKey("connectors.action.add")!;
    expect(
      addedFilter().compareDocumentPosition(add) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("打开后只留有实例的条目", async () => {
    entries = [
      catalogEntry("notion", "collab", [instance({ kind: "ready" })]),
      catalogEntry("sentry", "dev"),
    ];

    await mount();
    await act(async () => {
      addedFilter().click();
    });

    expect(cardCount()).toBe(1);
    expect(container.textContent).not.toContain("connectors.catalog.sentry");
    expect(addedFilter().getAttribute("aria-pressed")).toBe("true");
    // 计数统计的是全集，不是交集：筛选打开后 N 不变
    expect(addedCount()).toBe("1");
  });

  it("状态不参与判定：待授权 / 失败 / 停用都留在结果里", async () => {
    entries = [
      catalogEntry("notion", "collab", [instance({ kind: "needs-auth" })]),
      catalogEntry("sentry", "dev", [
        instance({ kind: "failed", message: "x" }),
      ]),
      customEntry("my-server"),
    ];

    await mount();
    await act(async () => {
      addedFilter().click();
    });

    expect(cardCount()).toBe(3);
  });

  it("计数跟筛选走：「全部」chip 等于可见卡片数", async () => {
    entries = [
      catalogEntry("notion", "collab", [instance({ kind: "ready" })]),
      catalogEntry("sentry", "dev"),
      catalogEntry("vercel", "dev"),
    ];

    await mount();
    expect(chipCount("all")).toBe("3");

    await act(async () => {
      addedFilter().click();
    });
    expect(chipCount("all")).toBe("1");
  });

  it("筛选归零时显示空态，「查看全部」能退出", async () => {
    entries = [catalogEntry("notion", "collab"), catalogEntry("sentry", "dev")];

    await mount();
    await act(async () => {
      addedFilter().click();
    });

    expect(container.textContent).toContain("connectors.filter.empty");
    // 屏幕阅读器：空态要作为状态播报，不能静默换掉列表
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "connectors.filter.empty",
    );
    expect(cardCount()).toBe(0);
    // 计数为 0 时开关照样在（F5），「全部」chip 也还在、「添加」按钮也还在
    expect(addedCount()).toBe("0");
    expect(chipCount("all")).toBe("0");

    const showAll = container.querySelector(
      '[data-testid="added-filter-show-all"]',
    ) as HTMLButtonElement;
    await act(async () => {
      showAll.click();
    });

    expect(cardCount()).toBe(2);
    expect(addedFilter().getAttribute("aria-pressed")).toBe("false");
    expect(container.textContent).not.toContain("connectors.filter.empty");
  });

  it("开着筛选时再选分类：两个维度叠加（交集）", async () => {
    entries = [
      catalogEntry("notion", "collab", [instance({ kind: "ready" })]),
      catalogEntry("sentry", "dev", [instance({ kind: "ready" })]),
      catalogEntry("vercel", "dev"),
    ];

    await mount();
    await clickChip("collab");
    expect(cardCount()).toBe(1);

    await act(async () => {
      addedFilter().click();
    });

    // 交集：剩下 collab 里已接入的那一张
    expect(cardCount()).toBe(1);
    expect(container.textContent).toContain("connectors.catalog.notion");
    expect(container.textContent).not.toContain("connectors.catalog.sentry");
    // 计数仍按已接入全集算（F8），不受选中分类影响
    expect(chipCount("all")).toBe("2");
    expect(addedCount()).toBe("2");
    // 未选中分类的 chip 计数也跟着筛选走：dev 里只剩已接入的 sentry
    expect(chipCount("dev")).toBe("1");
  });

  it("选中的分类被筛空时回落「全部」", async () => {
    entries = [
      catalogEntry("notion", "collab", [instance({ kind: "ready" })]),
      catalogEntry("sentry", "dev"),
    ];

    await mount();
    await clickChip("dev");
    expect(cardCount()).toBe(1);

    await act(async () => {
      addedFilter().click();
    });

    // dev 里没有已接入的条目 → 该分段消失、选中分类回落「全部」
    expect(chipCount("dev")).toBeUndefined();
    expect(cardCount()).toBe(1);
    expect(container.textContent).toContain("connectors.catalog.notion");
    expect(addedFilter().getAttribute("aria-pressed")).toBe("true");
  });
});
