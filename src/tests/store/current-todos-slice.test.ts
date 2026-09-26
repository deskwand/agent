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
});
