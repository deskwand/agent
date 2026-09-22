import type { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import {
  BrowserViewManager,
  PICKER_COMMAND_TIMEOUT_MS,
  PICKER_HIGHLIGHT_MS,
} from "../main/browser/browser-view-manager";

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    session: {},
    shell: {},
    WebContentsView: class {
      webContents = Object.assign(new EventEmitter(), {
        debugger: Object.assign(new EventEmitter(), {
          attached: false,
          isAttached() {
            return this.attached;
          },
          attach: vi.fn(function (this: { attached: boolean }) {
            // 真实 Electron：已有 debugger 时 attach 会拒绝
            if (this.attached) throw new Error("Another debugger is attached");
            this.attached = true;
          }),
          detach: vi.fn(function (this: { attached: boolean }) {
            this.attached = false;
          }),
          sendCommand: vi.fn(async (method: string) =>
            method === "DOM.getDocument"
              ? { root: { nodeId: 1 } }
              : method === "DOM.querySelectorAll"
                ? { nodeIds: [2] }
                : {},
          ),
        }),
        loadURL: vi.fn(async () => {}),
        getURL: () => "http://fixture/",
        getTitle: () => "Fixture",
        close: vi.fn(),
      });
      setVisible = vi.fn();
    },
  };
});

type FakeDebugger = EventEmitter & {
  attached: boolean;
  attach: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  sendCommand: ReturnType<typeof vi.fn>;
};
let manager: BrowserViewManager;
let dbg: FakeDebugger;

/** 一次完整拾取要跑完的整条 CDP 链路；缺数据会让"没送 selected"变成假通过。 */
const FULL_PROBE_CHAIN: Record<string, unknown> = {
  "DOM.getDocument": { root: { nodeId: 1 } },
  "DOM.querySelectorAll": { nodeIds: [2] },
  "DOM.pushNodesByBackendIdsToFrontend": { nodeIds: [2] },
  "DOM.describeNode": { node: { nodeName: "DIV", attributes: [] } },
  "DOM.getOuterHTML": { outerHTML: "<div></div>" },
  "DOM.getBoxModel": { model: { border: [0, 0, 10, 0, 10, 10, 0, 10] } },
  "CSS.getComputedStyleForNode": { computedStyle: [] },
  "Accessibility.getPartialAXTree": { nodes: [] },
  "DOM.resolveNode": { object: { objectId: "obj-1" } },
  "Runtime.callFunctionOn": {
    result: {
      value: {
        selector: "#target",
        selectorUnique: true,
        domPath: "div",
        text: "hi",
        viewport: { width: 800, height: 600, dpr: 2 },
        scroll: { x: 0, y: 0 },
        parent: null,
        siblings: [],
      },
    },
  },
};
const useFullProbeChain = (): void => {
  dbg.sendCommand.mockImplementation(async (method: string) =>
    method in FULL_PROBE_CHAIN ? FULL_PROBE_CHAIN[method] : {},
  );
};

beforeEach(() => {
  manager = new BrowserViewManager();
  manager.create({
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  } as unknown as BrowserWindow);
  const wc = manager.getWebContents()!;
  wc.emit("did-navigate", {}, "http://fixture/");
  manager.show();
  dbg = wc.debugger as unknown as FakeDebugger;
});

describe("picker lifecycle", () => {
  it("stop 后磁贴仍可高亮，且 stop 不 detach", async () => {
    expect(await manager.startPicker()).toEqual({ ok: true });
    await manager.stopPicker();
    expect(manager.isPickerActive()).toBe(false);
    expect(dbg.detach).not.toHaveBeenCalled();
    expect(await manager.highlight("#target")).toBe(true);
  });

  it("双 start 合并；启动中的 stop 使旧结果无效", async () => {
    let release!: (value: unknown) => void;
    dbg.sendCommand.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = manager.startPicker();
    const second = manager.startPicker();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const stopping = manager.stopPicker();
    release({});
    expect(await first).toEqual({ ok: false, reason: "not-available" });
    expect(await second).toEqual({ ok: false, reason: "not-available" });
    await stopping;
    expect(manager.isPickerActive()).toBe(false);
    expect(dbg.attach).toHaveBeenCalledTimes(1);
    expect(
      dbg.sendCommand.mock.calls.some(
        ([method, params]) =>
          method === "Overlay.setInspectMode" &&
          (params as { mode?: string } | undefined)?.mode === "searchForNode",
      ),
    ).toBe(false);
  });

  it.each(["Overlay.inspectModeCanceled", "navigation", "hide"])(
    "%s 退出后可重启",
    async (event) => {
      await manager.startPicker();
      if (event === "navigation")
        manager
          .getWebContents()!
          .emit("did-navigate", {}, "http://fixture/next");
      else if (event === "hide") {
        manager.hide();
        manager.show();
      } else dbg.emit("message", {}, event, {});
      await manager.stopPicker();
      expect(await manager.startPicker()).toEqual({ ok: true });
      expect(dbg.listenerCount("message")).toBe(1);
    },
  );
});

describe("picker races", () => {
  it("取消旧 capture 后再 start，不送旧 selected", async () => {
    const onSelected = vi.fn();
    manager.setPickerHandlers({ onStateChange: vi.fn(), onSelected });
    await manager.startPicker();
    // 完整链路：若代次未失效，旧 capture 会一路跑完并真的发出 selected。
    // 链路不全（只返回 {}）时这个断言会假通过——"没送 selected" 只是因为没数据。
    useFullProbeChain();
    let release!: (value: unknown) => void;
    dbg.sendCommand.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    dbg.emit("message", {}, "Overlay.inspectNodeRequested", {
      backendNodeId: 9,
    });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const stopping = manager.stopPicker();
    const restarting = manager.startPicker();
    release({ nodeIds: [9] });
    await stopping;
    await restarting;
    expect(onSelected).not.toHaveBeenCalled();
    expect(manager.isPickerActive()).toBe(true);
  });

  it("destroy 后旧启动不能激活", async () => {
    let release!: (value: unknown) => void;
    dbg.sendCommand.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const starting = manager.startPicker();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    manager.destroy();
    release({});
    expect(await starting).toEqual({ ok: false, reason: "not-available" });
    expect(manager.isPickerActive()).toBe(false);
    expect(dbg.detach).toHaveBeenCalledTimes(1);
  });

  it("初始化会先请求 document；重启不重复 attach", async () => {
    await manager.startPicker();
    await manager.stopPicker();
    await manager.startPicker();
    expect(dbg.attach).toHaveBeenCalledTimes(1);
    expect(dbg.sendCommand.mock.calls.map(([method]) => method)).toContain(
      "DOM.getDocument",
    );
  });

  it("debugger 已被别的客户端占用时返回 attach-failed，且不抢占不 detach", async () => {
    // 模拟 DevTools / 别的本地模块先 attach 了这条 webContents
    dbg.attached = true;
    useFullProbeChain();

    const result = await manager.startPicker();
    expect(result).toEqual({ ok: false, reason: "attach-failed" });
    expect(manager.isPickerActive()).toBe(false);
    // 关键：不去抢别人已经持有的会话
    expect(dbg.detach).not.toHaveBeenCalled();

    // 占用解除后仍可正常启用
    dbg.attached = false;
    expect(await manager.startPicker()).toEqual({ ok: true });
  });

  it("每次拾取后下一 tick 重新武装，多选可持续", async () => {
    const onSelected = vi.fn();
    manager.setPickerHandlers({ onStateChange: vi.fn(), onSelected });
    useFullProbeChain();
    await manager.startPicker();

    const arms = () =>
      dbg.sendCommand.mock.calls.filter(
        ([method, params]) =>
          method === "Overlay.setInspectMode" &&
          (params as { mode?: string } | undefined)?.mode === "searchForNode",
      ).length;

    dbg.emit("message", {}, "Overlay.inspectNodeRequested", {
      backendNodeId: 9,
    });
    await vi.waitFor(() => expect(onSelected).toHaveBeenCalledTimes(1));
    // 捕获结束后的下一 tick 重新武装：第二次点选仍然生效。
    await vi.waitFor(() => expect(arms()).toBe(2));

    dbg.emit("message", {}, "Overlay.inspectNodeRequested", {
      backendNodeId: 9,
    });
    await vi.waitFor(() => expect(onSelected).toHaveBeenCalledTimes(2));
  });

  it("pick 之后浏览器才自动 canceled，这次拾取仍要交付（spec §6）", async () => {
    const onSelected = vi.fn();
    const onStateChange = vi.fn();
    manager.setPickerHandlers({ onStateChange, onSelected });
    useFullProbeChain();
    await manager.startPicker();

    // 卡住捕获链的最后一环，制造"拾取已登记、交付尚未完成"的窗口
    let release!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const real = dbg.sendCommand.getMockImplementation() as
      | ((method: string, params?: unknown) => Promise<unknown>)
      | undefined;
    dbg.sendCommand.mockImplementation(
      async (method: string, params?: unknown) => {
        if (method === "Runtime.callFunctionOn") await gate;
        return real ? await real(method, params) : {};
      },
    );

    dbg.emit("message", {}, "Overlay.inspectNodeRequested", {
      backendNodeId: 9,
    });
    // 浏览器在拾取之后自行退出检查模式（spec §7 spike 2 点名的时序）
    dbg.emit("message", {}, "Overlay.inspectModeCanceled", {});
    release(undefined);

    // 用户已经点了，就得有结果；不能因为拨杆被自动关掉而丢掉这次拾取
    await vi.waitFor(() => expect(onSelected).toHaveBeenCalledTimes(1));
    expect(manager.isPickerActive()).toBe(false);
    // 已经退出拾取，不得再重新武装
    expect(
      dbg.sendCommand.mock.calls.filter(
        ([method, params]) =>
          method === "Overlay.setInspectMode" &&
          (params as { mode?: string } | undefined)?.mode === "searchForNode",
      ).length,
    ).toBe(1);
  });

  it("stop 后交付未完成的旧捕获不得送进下一次拾取", async () => {
    const onSelected = vi.fn();
    manager.setPickerHandlers({ onStateChange: vi.fn(), onSelected });
    useFullProbeChain();
    await manager.startPicker();

    let release!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const real = dbg.sendCommand.getMockImplementation() as
      | ((method: string, params?: unknown) => Promise<unknown>)
      | undefined;
    dbg.sendCommand.mockImplementation(
      async (method: string, params?: unknown) => {
        if (method === "Runtime.callFunctionOn") await gate;
        return real ? await real(method, params) : {};
      },
    );

    dbg.emit("message", {}, "Overlay.inspectNodeRequested", {
      backendNodeId: 9,
    });
    // 注意不能 await：stop/start 都排在尚未完成的捕获之后，gate 未开时会互相锁死。
    // 代次在 startPicker 的同步段就递增了，这才是作废旧捕获的依据。
    const stopped = manager.stopPicker();
    const restarted = manager.startPicker();
    release(undefined);
    await Promise.all([stopped, restarted]);

    expect(onSelected).not.toHaveBeenCalled();
  });
});

describe("取消必须能穿透一次卡住的捕获（不可恢复状态）", () => {
  it("捕获还没回来时，stopPicker 也必须立刻 disarm", async () => {
    useFullProbeChain();
    await manager.startPicker();

    // 卡住捕获链的最后一环：模拟一条永远不返回的 CDP 命令
    const real = dbg.sendCommand.getMockImplementation() as
      | ((method: string, params?: unknown) => Promise<unknown>)
      | undefined;
    dbg.sendCommand.mockImplementation(
      async (method: string, params?: unknown) => {
        if (method === "Runtime.callFunctionOn") return new Promise(() => {});
        return real ? await real(method, params) : {};
      },
    );

    dbg.emit("message", {}, "Overlay.inspectNodeRequested", {
      backendNodeId: 9,
    });
    // 等捕获真的进到那条卡住的命令
    await vi.waitFor(() =>
      expect(
        dbg.sendCommand.mock.calls.some(
          ([m]) => m === "Runtime.callFunctionOn",
        ),
      ).toBe(true),
    );

    await manager.stopPicker();
    // 关键：disarm 没有被那条卡住的命令堵住
    expect(
      dbg.sendCommand.mock.calls.filter(
        ([method, params]) =>
          method === "Overlay.setInspectMode" &&
          (params as { mode?: string } | undefined)?.mode === "none",
      ).length,
    ).toBe(1);
    expect(manager.isPickerActive()).toBe(false);
  });

  it("一条超时的命令不会永久堵住后续命令", async () => {
    vi.useFakeTimers();
    try {
      useFullProbeChain();
      await manager.startPicker();

      const real = dbg.sendCommand.getMockImplementation() as
        | ((method: string, params?: unknown) => Promise<unknown>)
        | undefined;
      let stuck = true;
      dbg.sendCommand.mockImplementation(
        async (method: string, params?: unknown) => {
          if (method === "DOM.getOuterHTML" && stuck) {
            return new Promise(() => {});
          }
          return real ? await real(method, params) : {};
        },
      );

      dbg.emit("message", {}, "Overlay.inspectNodeRequested", {
        backendNodeId: 9,
      });
      await vi.waitFor(() =>
        expect(
          dbg.sendCommand.mock.calls.some(([m]) => m === "DOM.getOuterHTML"),
        ).toBe(true),
      );

      // 超时后队列必须能继续：再点一次拾取仍然会重新武装
      await vi.advanceTimersByTimeAsync(PICKER_COMMAND_TIMEOUT_MS + 50);
      stuck = false;
      await manager.stopPicker();
      await manager.startPicker();
      expect(manager.isPickerActive()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("picker highlight is a transient flash, not a stuck overlay", () => {
  it("highlight 之后会自动清除（用户取消不掉的那层浮层）", async () => {
    vi.useFakeTimers();
    try {
      useFullProbeChain();
      // 注意：**不** startPicker —— 正是"拾取已关闭时点 chip 定位"那条路径
      expect(manager.isPickerActive()).toBe(false);
      expect(await manager.highlight("#target")).toBe(true);

      const hides = () =>
        dbg.sendCommand.mock.calls.filter(
          ([method]) => method === "Overlay.hideHighlight",
        ).length;
      expect(hides()).toBe(0);

      await vi.advanceTimersByTimeAsync(PICKER_HIGHLIGHT_MS + 10);
      await vi.waitFor(() => expect(hides()).toBe(1));
    } finally {
      vi.useRealTimers();
    }
  });

  it("clearHighlight 取消待执行的自动清除（不重复发命令）", async () => {
    vi.useFakeTimers();
    try {
      useFullProbeChain();
      await manager.highlight("#target");
      await manager.clearHighlight();

      const hides = () =>
        dbg.sendCommand.mock.calls.filter(
          ([method]) => method === "Overlay.hideHighlight",
        ).length;
      expect(hides()).toBe(1);

      await vi.advanceTimersByTimeAsync(PICKER_HIGHLIGHT_MS + 10);
      expect(hides()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("退出命令集合固定为 setInspectMode(none) + hideHighlight，不发 Overlay.disable", async () => {
    useFullProbeChain();
    await manager.startPicker();
    await manager.stopPicker();

    const overlayCalls = () =>
      dbg.sendCommand.mock.calls
        .map(([method]) => method as string)
        .filter((method) => method.startsWith("Overlay."));

    // 退出必须语义明确：恰好一次 setInspectMode(none)、恰好一次 hideHighlight
    expect(
      dbg.sendCommand.mock.calls.filter(
        ([method, params]) =>
          method === "Overlay.setInspectMode" &&
          (params as { mode?: string } | undefined)?.mode === "none",
      ),
    ).toHaveLength(1);
    expect(
      dbg.sendCommand.mock.calls.filter(
        ([method]) => method === "Overlay.hideHighlight",
      ),
    ).toHaveLength(1);
    // 不额外 disable Overlay：那是押在未验证机制上的兜底，而且会让下次启用
    // 重跑整轮 enable（代价落在常用的"起/停"路径上）
    expect(overlayCalls()).not.toContain("Overlay.disable");
  });

  it("stopPicker 立刻清掉高亮（不等定时器）", async () => {
    useFullProbeChain();
    await manager.startPicker();
    await manager.highlight("#target");
    await manager.stopPicker();
    expect(
      dbg.sendCommand.mock.calls.filter(
        ([method]) => method === "Overlay.hideHighlight",
      ).length,
    ).toBe(1);
  });
});
