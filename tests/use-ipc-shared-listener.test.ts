// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig, Message, ServerEvent } from "../src/renderer/types";

type AppStore = typeof import("../src/renderer/store").useAppStore;

function buildConfig(): AppConfig {
  return {
    provider: "anthropic",
    apiKey: "",
    model: "",
    theme: "light",
    themePreset: "default",
    autoSkillLearning: false,
  } as AppConfig;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useIPC shared listener", () => {
  let container: HTMLDivElement;
  let root: Root;
  let listeners: Set<(event: ServerEvent) => void>;
  let useAppStore: AppStore;

  beforeEach(async () => {
    vi.resetModules();
    listeners = new Set();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;

    const electronApi = {
      send: vi.fn(),
      on: vi.fn((callback: (event: ServerEvent) => void) => {
        listeners.add(callback);
        return () => {
          listeners.delete(callback);
        };
      }),
      invoke: vi.fn(async () => null),
      platform: "darwin",
      getSystemTheme: vi.fn(async () => ({ shouldUseDarkColors: false })),
      config: {
        get: vi.fn(async () => buildConfig()),
        isConfigured: vi.fn(async () => true),
      },
    };

    window.electronAPI = electronApi as unknown as Window["electronAPI"];

    ({ useAppStore } = await import("../src/renderer/store"));
    useAppStore.setState(useAppStore.getInitialState());

    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it("processes each stream.message event once even when multiple components use the hook", async () => {
    const { useIPC } = await import("../src/renderer/hooks/useIPC");

    function Harness() {
      useIPC();
      return null;
    }

    await act(async () => {
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(Harness),
          React.createElement(Harness),
        ),
      );
    });
    await flush();

    expect(listeners).toHaveLength(1);

    const message: Message = {
      id: "msg-1",
      sessionId: "s1",
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      timestamp: Date.now(),
      turnId: "turn-1",
    };

    const event = {
      type: "stream.message",
      payload: { sessionId: "s1", message, turnId: "turn-1" },
    } satisfies ServerEvent;

    await act(async () => {
      for (const listener of listeners) {
        listener(event);
      }
    });

    expect(useAppStore.getState().sessionStates.s1?.messages).toEqual([message]);
  });
});
