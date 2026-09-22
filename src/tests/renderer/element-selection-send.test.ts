// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { selectedButton } from "../fixtures/element-selection";
import { useAppStore } from "../../renderer/store";

// 必须在 import useIPC 之前把 electronAPI 放上去：useIPC 顶部的 isElectron
// 是模块级常量，构造时机在 import 求值那一刻。
const api = vi.hoisted(() => {
  const api = {
    invoke: vi.fn(async () => null),
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

import { useIPC } from "../../renderer/hooks/useIPC";

it("首条与续聊真实 IPC payload 均携带元素，prompt 仍是用户文字", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let ipc!: ReturnType<typeof useIPC>;
  function Harness() {
    ipc = useIPC();
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(React.createElement(Harness));
    });
    await act(async () => {
      await ipc.startSession(
        "修改",
        "改圆角",
        undefined,
        undefined,
        undefined,
        undefined,
        [selectedButton],
      );
      await ipc.continueSession("s1", "改圆角", undefined, undefined, [
        selectedButton,
      ]);
    });
    expect(api.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.start",
        payload: expect.objectContaining({
          prompt: "改圆角",
          elSelections: [selectedButton],
        }),
      }),
    );
    expect(api.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.continue",
        payload: expect.objectContaining({
          prompt: "改圆角",
          elSelections: [selectedButton],
        }),
      }),
    );

    // 乐观 user 消息必须带上**投影**（气泡回显的唯一来源）：
    // 它的 content 里没有合成块，元素信息只可能从这个字段来。
    const messages = useAppStore.getState().sessionStates.s1!.messages;
    const userMessage = messages.find((m) => m.role === "user");
    expect(userMessage?.elSelections).toEqual([
      {
        pageUrl: "http://fixture/",
        tag: "button",
        classes: ["primary"],
        text: "开始使用",
        selector: "button.primary",
        selectorUnique: true,
        width: 132,
        height: 40,
      },
    ]);
  } finally {
    await act(async () => root.unmount());
    Reflect.deleteProperty(window, "electronAPI");
  }
});

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
