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
 * 辅助的「技能云 / 插件」子视图按惯例 mock 掉（本用例从不切到那两个 tab，
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
    authorize: vi.fn(),
    cancelSignIn: vi.fn(),
    removeServer: vi.fn(),
    setEnabled: vi.fn(),
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
    transport: "http",
    summary: "connectors.summary.remote",
  };
}

/** 目录卡片：`instances` 为空就是「还没添加」，点了会走 addCatalogServer。 */
function notion(instances: ConnectorInstance[] = []): ConnectorEntry {
  return {
    key: "mcp:catalog:notion",
    serverName: "notion",
    source: "mcp-remote",
    tab: "connect",
    nameKey: "connectors.catalog.notion",
    descriptionKey: "connectors.catalog.notionDesc",
    instances,
  };
}

function byKey(key: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(key),
  );
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
