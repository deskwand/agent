// @vitest-environment jsdom
/**
 * Task 6a：设置里的选择控件（开发日志开关 + 归档会话复选）。
 *
 * 这里**不 mock** `SettingsSwitch` / `Checkbox` —— 被测的就是它们提供的语义
 * （role=switch / role=checkbox、aria-checked、disabled、可聚焦、点击只翻译一次）。
 * 只 mock 各自的服务：日志走 `window.electronAPI.logs`，归档走 `useIPC`。
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../renderer/types";

const { logs, ipc } = vi.hoisted(() => {
  const logsApi = {
    getAll: vi.fn(),
    getDirectory: vi.fn(),
    isEnabled: vi.fn(),
    setEnabled: vi.fn(),
    export: vi.fn(),
    open: vi.fn(),
    clear: vi.fn(),
  };
  // SettingsLogs 在**模块顶层**算 `isElectron = window.electronAPI !== undefined`
  // ⇒ electronAPI 必须在 import 之前就位，所以放在 hoisted（早于 import 执行）。
  // 只给 logs 一个切片；不要和 `Window` 求交（那会把 preload 的完整 API 类型
  // 也带进来，stub 就凑不齐 getPath/write）。
  (
    globalThis as unknown as {
      window: { electronAPI: { logs: typeof logsApi } };
    }
  ).window.electronAPI = { logs: logsApi };
  return {
    logs: logsApi,
    ipc: {
      unarchiveSession: vi.fn(),
      batchUnarchiveSessions: vi.fn(),
      permanentDeleteArchived: vi.fn(),
    },
  };
});

vi.mock("../../renderer/hooks/useIPC", () => ({ useIPC: () => ipc }));

vi.mock("react-i18next", () => {
  // `t` 必须是**稳定引用**：SettingsLogs 的 effect 依赖 loadLogs（其依赖 t），
  // 每次渲染换一个新函数会让 effect 重跑，把乐观更新又拉回服务值。
  const t = (key: string) => key;
  return {
    initReactI18next: { type: "3rdParty", init: () => {} },
    useTranslation: () => ({ t }),
  };
});

import { useAppStore } from "../../renderer/store";
import { SettingsArchived } from "../../renderer/components/settings/SettingsArchived";
import { SettingsLogs } from "../../renderer/components/settings/SettingsLogs";

let container: HTMLDivElement;
let root: Root;

/** 把已排队的 promise/效应跑完（服务 stub 是异步的，点击后的状态更新同理）。 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
  // 组件挂载后的服务调用（loadLogs / loadDevLogsStatus）是异步的。
  await flush();
}

function switchControl(): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>('[role="switch"]')!;
}

function checkboxes(): HTMLButtonElement[] {
  return [
    ...container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]'),
  ];
}

function archivedSession(id: string, title: string): Session {
  return {
    id,
    title,
    status: "idle",
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: false,
    createdAt: 1,
    updatedAt: 1,
    archived: true,
    archivedAt: 1,
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  (
    globalThis as unknown as { window: { electronAPI: { logs: typeof logs } } }
  ).window.electronAPI = { logs };
  logs.getAll.mockResolvedValue([]);
  logs.getDirectory.mockResolvedValue("/logs");
  logs.isEnabled.mockResolvedValue({ success: true, enabled: true });
  logs.setEnabled.mockResolvedValue({ success: true });
  logs.export.mockResolvedValue({ success: true, path: "/tmp/logs.zip" });
  logs.open.mockResolvedValue(undefined);
  logs.clear.mockResolvedValue({ success: true, deletedCount: 0 });
  ipc.unarchiveSession.mockReset();
  ipc.batchUnarchiveSessions.mockReset();
  ipc.permanentDeleteArchived.mockReset();
  useAppStore.setState({ sessions: [] });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("SettingsLogs 的开发日志开关", () => {
  it("是 role=switch，无障碍名走 i18n，aria-checked 跟随配置", async () => {
    logs.isEnabled.mockResolvedValue({ success: true, enabled: false });
    await render(<SettingsLogs isActive />);

    const control = switchControl();
    expect(control.tagName).toBe("BUTTON");
    expect(control.getAttribute("aria-label")).toBe("logs.enableDevLogs");
    expect(control.getAttribute("aria-checked")).toBe("false");
  });

  it("点击一次只写一次设置，并按服务结果更新 aria-checked", async () => {
    logs.isEnabled.mockResolvedValue({ success: true, enabled: false });
    await render(<SettingsLogs isActive />);

    await act(async () => {
      switchControl().click();
    });
    await flush();

    expect(logs.setEnabled).toHaveBeenCalledTimes(1);
    expect(logs.setEnabled).toHaveBeenCalledWith(true);
    expect(switchControl().getAttribute("aria-checked")).toBe("true");
  });

  it("loading 期间开关是 disabled，重复点击不再发写入", async () => {
    let settle: ((value: { success: boolean }) => void) | undefined;
    logs.setEnabled.mockImplementation(
      () =>
        new Promise<{ success: boolean }>((resolve) => {
          settle = resolve;
        }),
    );
    await render(<SettingsLogs isActive />);

    await act(async () => {
      switchControl().click();
    });

    expect(switchControl().disabled).toBe(true);
    expect(switchControl().getAttribute("aria-checked")).toBe("true");

    await act(async () => {
      switchControl().click();
    });
    expect(logs.setEnabled).toHaveBeenCalledTimes(1);

    await act(async () => {
      settle?.({ success: true });
    });
    await flush();
    expect(switchControl().disabled).toBe(false);
    expect(switchControl().getAttribute("aria-checked")).toBe("false");
  });
});

describe("SettingsArchived 的归档复选", () => {
  it("每个归档行是 checkbox，可聚焦，无障碍名是会话标题", async () => {
    useAppStore.setState({
      sessions: [
        archivedSession("s-1", "会话 A"),
        archivedSession("s-2", "会话 B"),
      ],
    });
    await render(<SettingsArchived />);

    const boxes = checkboxes();
    expect(boxes).toHaveLength(2);
    expect(boxes[0].getAttribute("aria-label")).toBe("会话 A");
    expect(boxes[0].getAttribute("aria-checked")).toBe("false");

    boxes[0].focus();
    expect(document.activeElement).toBe(boxes[0]);
  });

  it("整行点一次只切换一次，再点一次切回", async () => {
    useAppStore.setState({ sessions: [archivedSession("s-1", "会话 A")] });
    await render(<SettingsArchived />);

    // 行的容器；`.group` 是行自身的类，checkbox 在它里面。
    const row = checkboxes()[0].closest<HTMLElement>(".group")!;
    await act(async () => {
      row.click();
    });
    // 双触发会立刻切回 false —— 这里必须还是 true。
    expect(checkboxes()[0].getAttribute("aria-checked")).toBe("true");
    expect(ipc.batchUnarchiveSessions).not.toHaveBeenCalled();

    await act(async () => {
      row.click();
    });
    expect(checkboxes()[0].getAttribute("aria-checked")).toBe("false");
  });

  it("点控件一次只切换一次，不冒泡回整行", async () => {
    useAppStore.setState({ sessions: [archivedSession("s-1", "会话 A")] });
    await render(<SettingsArchived />);

    await act(async () => {
      checkboxes()[0].click();
    });

    expect(checkboxes()[0].getAttribute("aria-checked")).toBe("true");
  });

  it("多选后批量恢复发一次原 id 集合，并把选中清空", async () => {
    useAppStore.setState({
      sessions: [
        archivedSession("s-1", "会话 A"),
        archivedSession("s-2", "会话 B"),
      ],
    });
    await render(<SettingsArchived />);

    await act(async () => {
      checkboxes()[0].click();
      checkboxes()[1].click();
    });
    expect(checkboxes().map((box) => box.getAttribute("aria-checked"))).toEqual(
      ["true", "true"],
    );

    const batchRestore = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("sidebar.batchRestore"))!;
    await act(async () => {
      batchRestore.click();
    });

    expect(ipc.batchUnarchiveSessions).toHaveBeenCalledTimes(1);
    expect(ipc.batchUnarchiveSessions).toHaveBeenCalledWith(["s-1", "s-2"]);
    expect(checkboxes().map((box) => box.getAttribute("aria-checked"))).toEqual(
      ["false", "false"],
    );
  });

  it("筛选只影响渲染，已选集合在筛选前后保持", async () => {
    useAppStore.setState({
      sessions: [
        archivedSession("s-1", "会话 A"),
        archivedSession("s-2", "会话 B"),
      ],
    });
    await render(<SettingsArchived />);

    await act(async () => {
      checkboxes()[0].click();
    });

    const search = container.querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      // React 的受控输入：走原生 setter 再派发 input 事件。
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(search, "会话 B");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(checkboxes()).toHaveLength(1);
    expect(checkboxes()[0].getAttribute("aria-label")).toBe("会话 B");

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(search, "");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(checkboxes()).toHaveLength(2);
    expect(checkboxes()[0].getAttribute("aria-checked")).toBe("true");
    expect(checkboxes()[1].getAttribute("aria-checked")).toBe("false");
  });
});
