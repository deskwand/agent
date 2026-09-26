import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../renderer/store";
import type { ContentBlock, Message, MountedPath } from "../../renderer/types";

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState());
});

const session = {
  id: "s1",
  title: "t",
  status: "idle" as const,
  createdAt: 1,
  updatedAt: 1,
  cwd: "/tmp",
  mountedPaths: [] as MountedPath[],
  allowedTools: [] as string[],
  memoryEnabled: false,
  isProjectMode: false,
};

let seq = 0;
function assistant(content: ContentBlock[]): Message {
  seq += 1;
  return {
    id: `a${seq}`,
    sessionId: "s1",
    role: "assistant",
    timestamp: 1,
    content,
  };
}

const LIST = [{ content: "建表", status: "completed" }];

describe("currentTodos slice", () => {
  it("accumulates the list from an assistant message", () => {
    useAppStore.getState().addSession(session);
    useAppStore
      .getState()
      .addMessage(
        "s1",
        assistant([
          {
            type: "tool_use",
            id: "t1",
            name: "todo_write",
            input: { todos: LIST },
          },
        ]),
      );
    expect(useAppStore.getState().sessionStates["s1"].currentTodos).toEqual(
      LIST,
    );
  });

  it("keeps the previous list when a message has no todo_write", () => {
    const store = useAppStore.getState();
    store.addSession(session);
    store.addMessage(
      "s1",
      assistant([
        {
          type: "tool_use",
          id: "t1",
          name: "todo_write",
          input: { todos: LIST },
        },
      ]),
    );
    store.addMessage("s1", assistant([{ type: "text", text: "继续" }]));
    expect(useAppStore.getState().sessionStates["s1"].currentTodos).toEqual(
      LIST,
    );
  });

  it("clears the list when todo_write sends an empty array", () => {
    const store = useAppStore.getState();
    store.addSession(session);
    store.addMessage(
      "s1",
      assistant([
        {
          type: "tool_use",
          id: "t1",
          name: "todo_write",
          input: { todos: LIST },
        },
      ]),
    );
    store.addMessage(
      "s1",
      assistant([
        {
          type: "tool_use",
          id: "t2",
          name: "todo_write",
          input: { todos: [] },
        },
      ]),
    );
    expect(useAppStore.getState().sessionStates["s1"].currentTodos).toEqual([]);
  });

  it("never lets a rejected list into the slice", () => {
    const store = useAppStore.getState();
    store.addSession(session);
    store.addMessage(
      "s1",
      assistant([
        {
          type: "tool_use",
          id: "t1",
          name: "todo_write",
          input: {
            todos: [
              { content: "a", status: "in_progress" },
              { content: "b", status: "in_progress" },
            ],
          },
        },
      ]),
    );
    expect(useAppStore.getState().sessionStates["s1"].currentTodos).toBeNull();
  });

  it("rebuilds from the hydrated window", () => {
    const store = useAppStore.getState();
    store.addSession(session);
    store.setMessagesTail(
      "s1",
      [
        assistant([
          {
            type: "tool_use",
            id: "t1",
            name: "todo_write",
            input: { todos: LIST },
          },
        ]),
      ],
      false,
    );
    expect(useAppStore.getState().sessionStates["s1"].currentTodos).toEqual(
      LIST,
    );
  });

  it("keeps the slice when the window is later trimmed (compaction / paging)", () => {
    const store = useAppStore.getState();
    store.addSession(session);
    store.addMessage(
      "s1",
      assistant([
        {
          type: "tool_use",
          id: "t1",
          name: "todo_write",
          input: { todos: LIST },
        },
      ]),
    );
    // 模拟压缩后的窗口：一条 todo_write 都不剩
    store.setMessagesTail(
      "s1",
      [assistant([{ type: "text", text: "摘要" }])],
      false,
    );
    // 切片比窗口活得久 —— 这正是选"渲染层累积"而不是"每次扫窗口"的理由
    expect(useAppStore.getState().sessionStates["s1"].currentTodos).toEqual(
      LIST,
    );
  });
});

describe("lastNonEmptyTodos (收尾态数据源)", () => {
  const LIST2 = [
    { content: "建表", status: "completed" as const },
    { content: "写迁移", status: "completed" as const },
  ];

  function todoMsg(id: string, todos: unknown[]): Message {
    return assistant([
      { type: "tool_use", id, name: "todo_write", input: { todos } },
    ]);
  }

  it("remembers the last non-empty list", () => {
    const store = useAppStore.getState();
    store.addSession(session);
    store.addMessage("s1", todoMsg("t1", LIST));
    store.addMessage("s1", todoMsg("t2", LIST2));
    expect(
      useAppStore.getState().sessionStates["s1"].lastNonEmptyTodos,
    ).toEqual(LIST2);
  });

  it("keeps the remembered list when the model clears the list", () => {
    const store = useAppStore.getState();
    store.addSession(session);
    store.addMessage("s1", todoMsg("t1", LIST2));
    store.addMessage("s1", todoMsg("t2", []));
    const state = useAppStore.getState().sessionStates["s1"];
    expect(state.currentTodos).toEqual([]);
    expect(state.lastNonEmptyTodos).toEqual(LIST2);
  });

  it("drops the remembered list once the user sends a message", () => {
    const store = useAppStore.getState();
    store.addSession(session);
    store.addMessage("s1", todoMsg("t1", LIST2));
    store.addMessage("s1", {
      id: "u1",
      sessionId: "s1",
      role: "user",
      timestamp: 1,
      content: [{ type: "text", text: "下一件事" }],
    });
    expect(
      useAppStore.getState().sessionStates["s1"].lastNonEmptyTodos,
    ).toBeNull();
  });

  it("hydrate: 重建出非空清单时，两份都被写入", () => {
    const store = useAppStore.getState();
    store.addSession(session);
    store.setMessagesTail(
      "s1",
      [
        assistant([
          {
            type: "tool_use",
            id: "t1",
            name: "todo_write",
            input: { todos: LIST2 },
          },
        ]),
      ],
      false,
    );
    const state = useAppStore.getState().sessionStates["s1"];
    expect(state.currentTodos).toEqual(LIST2);
    expect(state.lastNonEmptyTodos).toEqual(LIST2);
  });

  it("hydrate: 重建结果是「已清空」时不写 lastNonEmptyTodos（重启后不进收尾态）", () => {
    const store = useAppStore.getState();
    store.addSession(session);
    store.setMessagesTail(
      "s1",
      [
        assistant([
          {
            type: "tool_use",
            id: "t1",
            name: "todo_write",
            input: { todos: [] },
          },
        ]),
      ],
      false,
    );
    const state = useAppStore.getState().sessionStates["s1"];
    expect(state.currentTodos).toEqual([]);
    expect(state.lastNonEmptyTodos).toBeNull();
  });

  it("stays null when nothing non-empty was ever seen", () => {
    const store = useAppStore.getState();
    store.addSession(session);
    store.addMessage("s1", todoMsg("t1", []));
    expect(
      useAppStore.getState().sessionStates["s1"].lastNonEmptyTodos,
    ).toBeNull();
  });
  describe("currentPlanDone / lastPlanDone", () => {
    const LIST2 = [
      { content: "建表", status: "completed" as const },
      { content: "写迁移", status: "completed" as const },
    ];

    function todoMsg(id: string, todos: unknown, done?: boolean): Message {
      return assistant([
        { type: "tool_use", id, name: "todo_write", input: { todos, done } },
      ]);
    }

    it("done: 非空清单声明结束后，两个布尔都为 true", () => {
      const store = useAppStore.getState();
      store.addSession(session);
      store.addMessage("s1", todoMsg("t1", LIST2, true));
      const state = useAppStore.getState().sessionStates["s1"];
      expect(state.currentPlanDone).toBe(true);
      expect(state.lastPlanDone).toBe(true);
    });

    it("done: 清空调用不得覆盖上一份清单自己的 done", () => {
      const store = useAppStore.getState();
      store.addSession(session);
      // 上一份清单**没有**声明结束
      store.addMessage("s1", todoMsg("t1", LIST2));
      // 清空时声称 done: true —— 必须被忽略（否则就是凭空伪造完成）
      store.addMessage("s1", todoMsg("t2", [], true));
      const state = useAppStore.getState().sessionStates["s1"];
      expect(state.currentPlanDone).toBe(false);
      expect(state.lastPlanDone).toBe(false);
      expect(state.lastNonEmptyTodos).toEqual(LIST2);
    });

    it("新一轮开始：整块计划退场（pill 不该挂着上一轮的清单）", () => {
      const store = useAppStore.getState();
      store.addSession(session);
      store.addMessage("s1", todoMsg("t1", LIST2, true));
      store.addMessage("s1", {
        id: "u1",
        sessionId: "s1",
        role: "user",
        timestamp: 1,
        content: [{ type: "text", text: "你好" }],
      });
      const state = useAppStore.getState().sessionStates["s1"];
      expect(state.currentTodos).toEqual([]);
      expect(state.currentPlanDone).toBe(false);
      expect(state.lastNonEmptyTodos).toBeNull();
      expect(state.lastPlanDone).toBe(false);

      // 关键：分页/重新水合时**不得**把上一轮的计划读回来。
      // 必须喂进**含 todo_write 的那一页**，否则这条断言没有判别力
      // （空页在 [] 与 null 两种实现下都不会写入任何东西）。
      store.setMessagesTail("s1", [todoMsg("t1", LIST2, true)], false);
      const state2 = useAppStore.getState().sessionStates["s1"];
      expect(state2.currentTodos).toEqual([]);
      expect(state2.lastNonEmptyTodos).toBeNull();
      expect(state2.lastPlanDone).toBe(false);
    });

    it("只有真人消息才是回合边界：自动续跑不得抹掉正在飞的计划", () => {
      const store = useAppStore.getState();
      store.addSession(session);
      store.addMessage("s1", todoMsg("t1", LIST2));
      // goal / 子代理完成通告注入的提示：role 是 user，但 autoGenerated
      store.addMessage("s1", {
        id: "u-auto",
        sessionId: "s1",
        role: "user",
        timestamp: 1,
        autoGenerated: true,
        content: [{ type: "text", text: "[自动续跑] 继续" }],
      });
      const state = useAppStore.getState().sessionStates["s1"];
      // 计划还在一轮中间 → 必须留着，否则后台子代理一完成 pill 就凭空消失
      expect(state.currentTodos).toEqual(LIST2);
      // 但收尾态的展示数据照旧退场（与本次改动之前一致）
      expect(state.lastNonEmptyTodos).toBeNull();
    });

    it("done: 人消息后一并清掉", () => {
      const store = useAppStore.getState();
      store.addSession(session);
      store.addMessage("s1", todoMsg("t1", LIST2, true));
      store.addMessage("s1", {
        id: "u1",
        sessionId: "s1",
        role: "user",
        timestamp: 1,
        content: [{ type: "text", text: "下一件事" }],
      });
      const state = useAppStore.getState().sessionStates["s1"];
      expect(state.lastNonEmptyTodos).toBeNull();
      expect(state.lastPlanDone).toBe(false);
    });

    it("done: 重建出「已清空」时不写 lastPlanDone", () => {
      const store = useAppStore.getState();
      store.addSession(session);
      store.setMessagesTail("s1", [todoMsg("t1", [], true)], false);
      const state = useAppStore.getState().sessionStates["s1"];
      expect(state.lastNonEmptyTodos).toBeNull();
      expect(state.lastPlanDone).toBe(false);
    });
  });
});
