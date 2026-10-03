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
    transport: "http",
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

  it("已授权（凭据在本地）不显示「未连接」，并说明接下来会发生什么", () => {
    // 用户刚在浏览器授权成功、凭据已落盘，此时运行时还没连上。
    // 显示「未连接」会让人以为授权失败了。
    const h = handlers();
    render(
      <ConnectorCard
        entry={entry({ instances: [withStatus({ kind: "authorized" })] })}
        {...h}
      />,
    );
    expect(container.textContent).toContain("connectors.status.authorized");
    expect(container.textContent).not.toContain("connectors.status.idle");
    expect(buttonByKey(DISCONNECT)).toBeDefined();
  });

  it("已授权不给主按钮：连着「已授权」旁边放「立即连接」是自相矛盾的", () => {
    // 「已授权」出现的条件（运行时无状态 + 凭据在本地）意味着没有活跃会话接手过它，
    // 而 activateNow 在没有会话时直接返回 false —— 这个按钮按下去什么也不会发生，
    // 只会重新注册一遍。用户真正需要知道的是「下次对话会自动连上」。
    const h = handlers();
    render(
      <ConnectorCard
        entry={entry({ instances: [withStatus({ kind: "authorized" })] })}
        {...h}
      />,
    );
    const labels = [...container.querySelectorAll("button")].map(
      (b) => b.textContent ?? "",
    );
    expect(
      labels.filter((l) => l.includes("connectors.action.connectNow")),
    ).toEqual([]);
    expect(
      labels.filter((l) => l.includes("connectors.action.connect")),
    ).toEqual([]);
    // 唯一的按钮是退路
    expect(labels.filter((l) => l.includes(DISCONNECT))).toHaveLength(1);
    // 状态行要解释「下次对话时连接」
    expect(container.textContent).toContain("connectors.status.authorizedHint");
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
      { kind: "authorized" },
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

  it("两个动作按钮是一个整体，状态文字不会跟它们挤在同一个容器里", () => {
    // 回归：底栏曾用 justify-between 摆「状态 + 两个按钮」三个子元素，
    // 中间那个（「取消」）被甩到卡片正中。
    // 注意：只断言「两个按钮同父节点」是无效护栏 —— 它们本来就在同一个底栏 div 里，
    // 修复前也会通过。真正要守的是「那个容器里没有状态文字」。
    const h = handlers();
    render(
      <ConnectorCard
        entry={entry({ instances: [withStatus({ kind: "idle" })] })}
        authorizing
        {...h}
      />,
    );

    const cancel = buttonByKey(CANCEL)!;
    const disconnect = buttonByKey(DISCONNECT)!;
    const group = cancel.parentElement!;

    expect(group).toBe(disconnect.parentElement);
    expect(group.className).toContain("flex-none");
    // 容器里只应该有按钮：状态文字若被塞回来，说明按钮组又被摆进了
    // 「状态 + 按钮」的两端对齐容器里（P3 的根因）。这条不依赖 i18n mock 的返回值。
    expect(
      Array.from(group.children).every((c) => c.tagName === "BUTTON"),
    ).toBe(true);
    expect(group.textContent).not.toContain("connectors.status.");
  });
});

describe("本机能力卡片", () => {
  const capability = (instances: ConnectorInstance[] = []): ConnectorEntry =>
    entry({
      key: "mcp:builtin:GUI_Operate",
      serverName: "GUI_Operate",
      source: "mcp-builtin",
      transport: "stdio",
      nameKey: "connectors.builtin.guiOperate",
      descriptionKey: "connectors.builtin.guiOperateDesc",
      instances,
    });

  it("未添加过的预设，开关照样能点开", () => {
    // 回归：`disabled={!instance}` 让这个开关永远是灰的，
    // 而 registry 明明支持「先写进 mcp.json 再启用」。
    const h = handlers();
    render(<ConnectorCard entry={capability()} {...h} />);

    const sw = container.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(sw).toBeDefined();
    expect(sw.disabled).toBe(false);

    act(() => sw.click());
    // 传 serverName，不是 undefined
    expect(h.onToggle).toHaveBeenCalledWith("GUI_Operate", true);
  });

  it("已启用的预设，点一下关闭", () => {
    const h = handlers();
    render(
      <ConnectorCard
        entry={capability([
          {
            id: "GUI_Operate",
            label: "GUI_Operate",
            status: { kind: "ready" },
            summary: "connectors.summary.local",
          },
        ])}
        {...h}
      />,
    );
    const sw = container.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(sw.getAttribute("aria-checked")).toBe("true");
    act(() => sw.click());
    expect(h.onToggle).toHaveBeenCalledWith("GUI_Operate", false);
  });
});

describe("传输徽标", () => {
  const badgeText = () =>
    container.querySelector('[data-testid="transport-badge"]')?.textContent;

  it("远程条目标「远程」", () => {
    render(<ConnectorCard entry={entry()} {...handlers()} />);
    expect(badgeText()).toBe("connectors.transport.remote");
  });

  it("本机条目标「本机」", () => {
    render(
      <ConnectorCard
        entry={entry({ source: "mcp-builtin", transport: "stdio" })}
        {...handlers()}
      />,
    );
    expect(badgeText()).toBe("connectors.transport.local");
  });

  it("未添加的条目也保留槽位", () => {
    // instances 为空时徽标仍要在 —— 否则加入后整张卡片会变宽
    render(
      <ConnectorCard
        entry={entry({
          source: "mcp-builtin",
          transport: "stdio",
          instances: [],
        })}
        {...handlers()}
      />,
    );
    expect(badgeText()).toBe("connectors.transport.local");
  });
});

describe("状态行对齐", () => {
  it("状态文字与名称/描述左对齐 —— 不留透明占位圆点", () => {
    render(<ConnectorCard entry={entry()} {...handlers()} />);
    const status = container.querySelector('[data-testid="card-status"]')!;
    // 父元素里除了状态文字不该有别的子元素：那个占位圆点会把文字右推一格，
    // 于是「未启用」看起来比名称和描述缩进（用户报过）。
    expect(status.parentElement!.children.length).toBe(1);
  });

  it("状态用文字颜色表达，不再靠圆点", () => {
    render(
      <ConnectorCard
        entry={entry({ instances: [withStatus({ kind: "ready" })] })}
        {...handlers()}
      />,
    );
    expect(
      container.querySelector('[data-testid="card-status"]')!.className,
    ).toContain("text-success");
  });
});
