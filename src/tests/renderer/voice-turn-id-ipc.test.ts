// @vitest-environment jsdom
//
// 语音提交要带调用方分配的 turnId：回答按它归属、播放按它取数。
// 这里钉住 IPC 这一环 —— App → continueSession / startSession → 后端 payload
// 的 turnId 必须是传进来的那一个，而不是自己生成的 `turn-<时间戳>`。
// 漏接不会报错，只会让回答找不着轮次（表现为浮层一直停在 thinking）。
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import type { Session } from "../../renderer/types";

const bridge = vi.hoisted(() => {
  const api = {
    invoke: vi.fn(async (_event?: unknown): Promise<unknown> => null),
    send: vi.fn(),
    on: vi.fn(() => () => {}),
    config: {
      get: vi.fn(async () => ({})),
      isConfigured: vi.fn(async () => false),
    },
    getSystemTheme: vi.fn(async () => ({ shouldUseDarkColors: false })),
  };
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: api,
  });
  return api;
});

// 必须在 import useIPC 之前放好 electronAPI：isElectron 是模块级常量。
import { useIPC } from "../../renderer/hooks/useIPC";

function makeSession(id: string): Session {
  return {
    id,
    title: `Session ${id}`,
    status: "idle",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    cwd: "/tmp",
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: false,
  };
}

function payloadOf(call: number) {
  return bridge.send.mock.calls[call][0].payload as {
    turnId: string;
    sessionId: string;
  };
}

describe("语音轮次标识进 IPC", () => {
  let container: HTMLDivElement;
  let root: Root;
  let ipc!: ReturnType<typeof useIPC>;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState(useAppStore.getInitialState());
    useAppStore.getState().addSession(makeSession("s1"));
    bridge.send.mockClear();

    function Harness() {
      ipc = useIPC();
      return null;
    }
    container = document.createElement("div");
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(Harness));
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("continueSession 用调用方给的 turnId", async () => {
    await act(async () => {
      await ipc.continueSession(
        "s1",
        "新问题",
        undefined,
        undefined,
        undefined,
        "voice",
        "voice-turn-test",
      );
    });

    expect(payloadOf(0)).toMatchObject({
      sessionId: "s1",
      turnId: "voice-turn-test",
    });
    const messages = useAppStore.getState().sessionStates["s1"]!.messages;
    expect(messages.at(-1)?.turnId).toBe("voice-turn-test");
  });

  it("不传 turnId 时仍自己生成", async () => {
    await act(async () => {
      await ipc.continueSession("s1", "普通消息");
    });

    expect(payloadOf(0).turnId).toMatch(/^turn-\d+$/);
  });
});
