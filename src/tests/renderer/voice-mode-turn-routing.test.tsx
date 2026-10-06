// @vitest-environment jsdom
//
// 轮询的取数与收尾：两个坑都在这条路径上。
// 1）回答必须按 turnId 取 —— 旧轮还在生成时取错轮就等于念旧话。
// 2）收尾不能靠"partial 被清空"或"文本静止 600ms" —— 助手消息落库只代表
//    这一条消息完了（工具调用之间会落好几条），而模型思考时也会静很久。
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { useAppStore } from "../../renderer/store";
import type { Message, Session } from "../../renderer/types";

const captured = vi.hoisted(() => ({
  deps: null as null | {
    sendQuestion(text: string): boolean;
    onQuestion(text: string): void;
  },
  sendAnswerDelta: vi.fn(),
  start: vi.fn(async () => {}),
  stop: vi.fn(),
}));

vi.mock("../../renderer/hooks/useVoiceConversation", () => ({
  createVoiceConversation: (deps: typeof captured.deps) => {
    captured.deps = deps;
    return {
      start: captured.start,
      stop: captured.stop,
      setBlocked: vi.fn(),
      setMuted: vi.fn(),
      sendAnswerDelta: captured.sendAnswerDelta,
      state: () => "listening",
    };
  },
}));
vi.mock("../../renderer/utils/voice/voice-sfx", () => ({
  createVoiceSfx: () => ({ startCue: vi.fn(), exitCue: vi.fn() }),
}));

import { useVoiceMode } from "../../renderer/hooks/useVoiceMode";

const SESSION = "voice-1";

function makeSession(): Session {
  return {
    id: SESSION,
    kind: "voice",
    title: "Voice",
    status: "running",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    cwd: "/tmp",
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: false,
  };
}

function message(
  role: "user" | "assistant",
  turnId: string,
  text: string,
): Message {
  return {
    id: `msg-${role}-${turnId}-${text.length}`,
    sessionId: SESSION,
    role,
    content: [{ type: "text", text }],
    timestamp: Date.now(),
    turnId,
  };
}

describe("useVoiceMode 回答轮次路由", () => {
  let container: HTMLDivElement;
  let root: Root;
  let sendQuestion: Mock<(text: string, turnId: string) => boolean>;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    class AudioContextStub {
      close = vi.fn(async () => {});
    }
    vi.stubGlobal("AudioContext", AudioContextStub);
    useAppStore.setState(useAppStore.getInitialState());
    useAppStore.getState().addSession(makeSession());
    // 宿主守卫会检查"浮层开着、就是这条语音会话、人在聊天页"，
    // 与真实宿主状态一致。
    useAppStore.getState().setActiveSession(SESSION);
    useAppStore.getState().openVoiceMode(SESSION);
    captured.sendAnswerDelta.mockClear();
    sendQuestion = vi.fn<(text: string, turnId: string) => boolean>(() => true);

    container = document.createElement("div");
    root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(() => {
          useVoiceMode({
            sessionId: SESSION,
            isCompacting: false,
            muted: false,
            sendQuestion,
          });
          return null;
        }),
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** 推进一次轮询。 */
  const tick = async (ms = 120) => {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  };

  /** 宿主提交一个问题，返回它实际使用的 turnId。 */
  const ask = (text: string): string => {
    let accepted = false;
    act(() => {
      accepted = captured.deps!.sendQuestion(text);
    });
    expect(accepted).toBe(true);
    return sendQuestion.mock.calls.at(-1)![1] as string;
  };

  it("只播放本轮的文字，旧轮的长 partial 不参与", async () => {
    const store = useAppStore.getState();
    // 旧轮：还在生成，文字比新轮长得多
    store.setPartialMessage(SESSION, "旧回答还在生成的一段很长的文字。", "old");

    const turnId = ask("新问题");
    expect(sendQuestion).toHaveBeenCalledWith("新问题", turnId);
    act(() => {
      store.addMessage(SESSION, message("user", turnId, "新问题"));
      store.activateNextTurn(SESSION, "step-1", turnId);
    });

    await tick();
    expect(captured.sendAnswerDelta).not.toHaveBeenCalled();

    act(() => {
      useAppStore.getState().setPartialMessage(SESSION, "新回答。", turnId);
    });
    await tick();
    expect(captured.sendAnswerDelta).toHaveBeenCalledWith("新回答。", false);
  });

  it("消息落库但轮次没结束时不收尾，后续文字接着播", async () => {
    const store = useAppStore.getState();
    const turnId = ask("帮我查一下");
    act(() => {
      store.addMessage(SESSION, message("user", turnId, "帮我查一下"));
      store.activateNextTurn(SESSION, "step-1", turnId);
      store.setPartialMessage(SESSION, "第一句。", turnId);
    });
    await tick();
    expect(captured.sendAnswerDelta).toHaveBeenLastCalledWith(
      "第一句。",
      false,
    );

    // 模型静了很久（远超 600ms），也没说它结束
    await tick(720);
    expect(
      captured.sendAnswerDelta.mock.calls.some(([, ended]) => ended === true),
    ).toBe(false);

    // 工具调用之间落一条消息：partial 被 store 清掉，会话仍在跑
    act(() => {
      store.addMessage(SESSION, message("assistant", turnId, "第一句。"));
    });
    await tick();
    expect(
      captured.sendAnswerDelta.mock.calls.some(([, ended]) => ended === true),
    ).toBe(false);

    // 工具之后接着生成
    act(() => {
      useAppStore.getState().setPartialMessage(SESSION, "第二句。", turnId);
    });
    await tick();
    expect(captured.sendAnswerDelta).toHaveBeenLastCalledWith(
      "第一句。\n第二句。",
      false,
    );
  });

  it("轮次真正结束才收尾，而且只收一次", async () => {
    const store = useAppStore.getState();
    const turnId = ask("短问题");
    act(() => {
      store.addMessage(SESSION, message("user", turnId, "短问题"));
      store.activateNextTurn(SESSION, "step-1", turnId);
    });

    // 两次轮询之间就答完了：没有 partial 阶段可看，只能读落库的消息
    act(() => {
      store.setPartialMessage(SESSION, "短回答。", turnId);
      store.addMessage(SESSION, message("assistant", turnId, "短回答。"));
      store.clearActiveTurn(SESSION, "step-1");
      store.updateSession(SESSION, { status: "idle" });
    });
    await tick();
    expect(captured.sendAnswerDelta).toHaveBeenLastCalledWith("短回答。", true);

    const calls = captured.sendAnswerDelta.mock.calls.length;
    await tick(600);
    expect(captured.sendAnswerDelta.mock.calls.length).toBe(calls);
  });

  it("排队等待期间不提前收尾", async () => {
    const store = useAppStore.getState();
    // 上一轮还在跑：新问题进 pendingTurns
    store.addMessage(SESSION, message("user", "old", "上一轮问题"));
    store.activateNextTurn(SESSION, "step-old", "old");

    const turnId = ask("新问题");
    act(() => {
      store.addMessage(SESSION, message("user", turnId, "新问题"));
    });
    await tick(300);
    expect(
      captured.sendAnswerDelta.mock.calls.some(([, ended]) => ended === true),
    ).toBe(false);

    // 轮到自己，然后再结束
    act(() => {
      store.activateNextTurn(SESSION, "step-1", turnId);
      useAppStore.getState().setPartialMessage(SESSION, "轮到我了。", turnId);
    });
    await tick();
    expect(captured.sendAnswerDelta).toHaveBeenLastCalledWith(
      "轮到我了。",
      false,
    );

    act(() => {
      useAppStore.getState().clearActiveTurn(SESSION, "step-1");
      useAppStore.getState().updateSession(SESSION, { status: "idle" });
    });
    await tick();
    expect(captured.sendAnswerDelta).toHaveBeenLastCalledWith(
      "轮到我了。",
      true,
    );
  });

  it("没有任何可读文本的轮次也要收尾一次", async () => {
    const store = useAppStore.getState();
    const turnId = ask("跑个命令");
    act(() => {
      store.addMessage(SESSION, message("user", turnId, "跑个命令"));
      store.activateNextTurn(SESSION, "step-1", turnId);
    });
    await tick();

    act(() => {
      store.clearActiveTurn(SESSION, "step-1");
      store.updateSession(SESSION, { status: "idle" });
    });
    await tick();
    expect(captured.sendAnswerDelta).toHaveBeenLastCalledWith("", true);
  });

  it("卸载后不再取数", async () => {
    const turnId = ask("再见");
    act(() => {
      useAppStore
        .getState()
        .addMessage(SESSION, message("user", turnId, "再见"));
      useAppStore.getState().activateNextTurn(SESSION, "step-1", turnId);
      useAppStore.getState().setPartialMessage(SESSION, "再见。", turnId);
    });
    await tick();
    expect(captured.sendAnswerDelta).toHaveBeenCalled();

    act(() => root.unmount());
    captured.sendAnswerDelta.mockClear();
    await tick(600);
    expect(captured.sendAnswerDelta).not.toHaveBeenCalled();
  });
});
