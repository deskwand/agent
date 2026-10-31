// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { useAppStore } from "../../renderer/store";
import type { Message } from "../../renderer/types";

function assistant(id: string, text: string): Message {
  return {
    id,
    sessionId: "s1",
    role: "assistant",
    content: [{ type: "text", text }],
    timestamp: 1,
  } as Message;
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
});

it("replaces the window and clears transient state", () => {
  const store = useAppStore.getState();
  store.setMessages("s1", [assistant("a1", "旧"), assistant("a2", "旧")]);
  store.addSteerRecord("s1", "注入的引导", "a2");
  store.setPartialMessage("s1", "半截输出", "t1");
  store.setReadAloud({ messageId: "a2", status: "playing" });

  useAppStore.getState().applyRewind("s1", [assistant("a1", "保留")], false);

  const state = useAppStore.getState();
  const ss = state.sessionStates.s1;
  expect(ss.messages.map((message) => message.id)).toEqual(["a1"]);
  expect(ss.messages[0].content).toEqual([{ type: "text", text: "保留" }]);
  expect(ss.oldestMessageId).toBe("a1");
  expect(ss.hasMoreOlder).toBe(false);
  expect(ss.historyHydrated).toBe(true);
  expect(ss.steerRecords).toEqual([]);
  expect(ss.partialByTurn).toEqual({});
  expect(ss.currentTodos).toBeNull();
  // 被删消息可能正在朗读，停止键却在那张已消失的卡片上
  expect(state.readAloud.status).toBe("idle");
  expect(state.readAloud.messageId).toBeNull();
});

it("drops queued messages that no longer belong to the history", () => {
  const store = useAppStore.getState();
  const queued = {
    ...assistant("a2", "排队中"),
    localStatus: "queued" as const,
  };
  store.setMessages("s1", [assistant("a1", "保留"), queued]);

  useAppStore.getState().applyRewind("s1", [assistant("a1", "保留")], false);

  const ss = useAppStore.getState().sessionStates.s1;
  expect(ss.messages.map((message) => message.id)).toEqual(["a1"]);
  expect(ss.messages.some((message) => message.localStatus === "queued")).toBe(
    false,
  );
});

it("keeps hasMore when the kept window is still paged", () => {
  const store = useAppStore.getState();
  store.setMessages("s1", [assistant("a1", "旧")]);

  useAppStore.getState().applyRewind("s1", [assistant("a9", "页首")], true);

  const ss = useAppStore.getState().sessionStates.s1;
  expect(ss.hasMoreOlder).toBe(true);
});
