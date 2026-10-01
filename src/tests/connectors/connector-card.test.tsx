// @vitest-environment jsdom
/**
 * ConnectorCard 的组件级测试。
 *
 * **为什么要有这一层**：之前两个 bug 都出在「UI 的闸门」上——
 *   1. 「连接」按钮传的是 `entry.key`（复合键），registry 认不出；
 *   2. 能力开关写了 `disabled={!instance}`，未添加的预设永远点不开。
 * 两次我都只测了 registry（直接调方法），**绕过了按钮本身**，于是全绿却不可用。
 * 这里渲染组件、点真实按钮，守住用户实际触碰的那一层。
 *
 * i18n 按本仓组件测试的惯例整模块 mock：`t(key) => key`，所以断言用 key。
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectorCard } from "../../renderer/components/connectors/ConnectorCard";
import type {
  ConnectorEntry,
  ConnectorInstance,
  ConnectorStatus,
} from "../../shared/connectors";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function handlers() {
  return {
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onAuthorize: vi.fn(),
    onCancel: vi.fn(),
    onToggle: vi.fn(),
  };
}

function withStatus(status: ConnectorStatus): ConnectorInstance {
  return {
    id: "notion",
    label: "notion",
    status,
    summary: "connectors.summary.remote",
  };
}

function entry(over: Partial<ConnectorEntry> = {}): ConnectorEntry {
  return {
    key: "mcp:catalog:notion",
    serverName: "notion",
    source: "mcp-remote",
    tab: "connect",
    nameKey: "connectors.catalog.notion",
    descriptionKey: "connectors.catalog.notionDesc",
    instances: [],
    ...over,
  };
}

function render(node: React.ReactElement): void {
  act(() => {
    root.render(node);
  });
}

function buttonByKey(key: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(key),
  );
}

const CONNECT = "connectors.action.connect";
const DISCONNECT = "connectors.action.disconnect";
const CANCEL = "connectors.action.cancel";
const RETRY = "connectors.action.retry";

describe("远程服务卡片", () => {
  it("未添加时给出可点的「连接」，传的是 serverName", () => {
    const h = handlers();
    render(<ConnectorCard entry={entry()} {...h} />);

    const btn = buttonByKey(CONNECT)!;
    expect(btn).toBeDefined();
    expect(btn.disabled).toBe(false);

    act(() => btn.click());
    // registry 按 serverName 查目录；传 entry.key 会得到 "unknown catalog key"
    expect(h.onConnect).toHaveBeenCalledWith("notion");
  });

  it("idle（已配置但运行时没有状态）不谎称进行中，并给出重试与断开", () => {
    const h = handlers();
    render(
      <ConnectorCard
        entry={entry({ instances: [withStatus({ kind: "idle" })] })}
        {...h}
      />,
    );

    expect(container.textContent).toContain("connectors.status.idle");
    expect(container.textContent).not.toContain("connectors.status.connecting");
    expect(buttonByKey(CONNECT)).toBeDefined();
    expect(buttonByKey(DISCONNECT)).toBeDefined();
  });

  it("本地授权待处理时给出「取消」，未添加的条目也传 serverName", () => {
    // 传输层此时可能什么都还没发生（实例都还没写进 mcp.json），
    // 但用户刚点过「连接」，必须能中止。
    const h = handlers();
    render(<ConnectorCard entry={entry()} authorizing {...h} />);

    const cancel = buttonByKey(CANCEL)!;
    expect(cancel).toBeDefined();
    expect(cancel.disabled).toBe(false);
    act(() => cancel.click());
    // registry 按 mcp.json 里的 server 名查授权表 —— 没有实例时用 serverName
    expect(h.onCancel).toHaveBeenCalledWith("notion");
  });

  it("本地授权待处理优先于传输状态，且已有实例时保留退路", () => {
    const h = handlers();
    render(
      <ConnectorCard
        entry={entry({ instances: [withStatus({ kind: "idle" })] })}
        authorizing
        {...h}
      />,
    );

    expect(container.textContent).toContain("connectors.status.connecting");
    expect(buttonByKey(CANCEL)).toBeDefined();
    expect(buttonByKey(DISCONNECT)).toBeDefined();
  });

  it("传输层的 connecting 只留「断开」，不调 signIn 的取消", () => {
    // cancelSignIn 中止的是 OAuth 等待；传输层在连但没有本地授权流程时
    // 它找不到东西可中止，所以这里根本不该出现「取消」。
    const h = handlers();
    render(
      <ConnectorCard
        entry={entry({ instances: [withStatus({ kind: "connecting" })] })}
        {...h}
      />,
    );

    expect(buttonByKey(CANCEL)).toBeUndefined();
    const disconnect = buttonByKey(DISCONNECT)!;
    expect(disconnect.disabled).toBe(false);
    act(() => disconnect.click());
    expect(h.onDisconnect).toHaveBeenCalledWith("notion");
    expect(h.onCancel).not.toHaveBeenCalled();
  });

  it("每个非 ready 状态都保留「断开」这条退路", () => {
    const statuses: ConnectorStatus[] = [
      { kind: "idle" },
      { kind: "connecting" },
      { kind: "needs-auth" },
      { kind: "failed", message: "boom" },
      { kind: "off" },
    ];
    for (const status of statuses) {
      const h = handlers();
      render(
        <ConnectorCard
          entry={entry({ instances: [withStatus(status)] })}
          {...h}
        />,
      );
      expect(
        buttonByKey(DISCONNECT),
        `status=${status.kind} 没有退路`,
      ).toBeDefined();
    }
  });

  it("failed 给「重试」并调到 onAuthorize", () => {
    const h = handlers();
    render(
      <ConnectorCard
        entry={entry({
          instances: [withStatus({ kind: "failed", message: "x" })],
        })}
        {...h}
      />,
    );
    const retry = buttonByKey(RETRY)!;
    act(() => retry.click());
    expect(h.onAuthorize).toHaveBeenCalledWith("notion");
  });

  it("卡片里没有任何 disabled 的死路按钮", () => {
    const h = handlers();
    render(
      <ConnectorCard
        entry={entry({ instances: [withStatus({ kind: "connecting" })] })}
        {...h}
      />,
    );
    for (const b of container.querySelectorAll("button")) {
      expect(b.disabled, `意外禁用：${b.textContent}`).toBe(false);
    }
  });
});

describe("本机能力卡片", () => {
  const capability = (instances: ConnectorInstance[] = []): ConnectorEntry =>
    entry({
      key: "mcp:builtin:Chrome",
      serverName: "Chrome",
      source: "mcp-builtin",
      tab: "capability",
      nameKey: "connectors.builtin.chrome",
      descriptionKey: "connectors.builtin.chromeDesc",
      instances,
    });

  it("未添加过的预设，开关照样能点开", () => {
    // 回归：`disabled={!instance}` 让这个开关永远是灰的，
    // 而 registry 明明支持「先写进 mcp.json 再启用」。
    const h = handlers();
    render(<ConnectorCard entry={capability()} variant="row" {...h} />);

    const sw = container.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(sw).toBeDefined();
    expect(sw.disabled).toBe(false);

    act(() => sw.click());
    // 传 serverName，不是 undefined
    expect(h.onToggle).toHaveBeenCalledWith("Chrome", true);
  });

  it("已启用的预设，点一下关闭", () => {
    const h = handlers();
    render(
      <ConnectorCard
        entry={capability([
          {
            id: "Chrome",
            label: "Chrome",
            status: { kind: "ready" },
            summary: "connectors.summary.local",
          },
        ])}
        variant="row"
        {...h}
      />,
    );
    const sw = container.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(sw.getAttribute("aria-checked")).toBe("true");
    act(() => sw.click());
    expect(h.onToggle).toHaveBeenCalledWith("Chrome", false);
  });
});
