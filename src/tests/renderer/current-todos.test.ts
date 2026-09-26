import { describe, expect, it } from "vitest";
import { collectCurrentTodos } from "../../renderer/utils/current-todos";
import type { ContentBlock, Message } from "../../renderer/types";

function msg(content: ContentBlock[]): Message {
  return { id: "m", sessionId: "s1", role: "assistant", timestamp: 1, content };
}

function todoWrite(id: string, todos: unknown): ContentBlock {
  return { type: "tool_use", id, name: "todo_write", input: { todos } };
}

const DONE = { content: "建表", status: "completed" };
const ACTIVE = { content: "写迁移", status: "in_progress" };

describe("collectCurrentTodos", () => {
  it("returns null when there is no todo_write at all", () => {
    expect(collectCurrentTodos(undefined)).toBeNull();
    expect(collectCurrentTodos([])).toBeNull();
    expect(
      collectCurrentTodos([
        msg([{ type: "text", text: "hi" }]),
        msg([{ type: "tool_use", id: "t1", name: "bash", input: {} }]),
      ]),
    ).toBeNull();
  });

  it("returns the last valid list when several calls exist", () => {
    const first = msg([todoWrite("t1", [DONE])]);
    const second = msg([todoWrite("t2", [DONE, ACTIVE])]);
    expect(collectCurrentTodos([first, second])).toEqual([DONE, ACTIVE]);
    // 顺序反过来也必须取"最后一条"，而不是"第一条"
    expect(collectCurrentTodos([second, first])).toEqual([DONE]);
  });

  it("returns an empty array when the last call cleared the list", () => {
    expect(collectCurrentTodos([msg([todoWrite("t1", [])])])).toEqual([]);
  });

  it("skips rejected lists and keeps looking backwards", () => {
    // 两条 in_progress → 被工具拒绝，不生效
    const rejected = msg([
      todoWrite("t2", [
        { content: "a", status: "in_progress" },
        { content: "b", status: "in_progress" },
      ]),
    ]);
    const valid = msg([todoWrite("t1", [DONE])]);
    expect(collectCurrentTodos([valid, rejected])).toEqual([DONE]);

    // 只有被拒的那条 → 没有生效清单
    expect(collectCurrentTodos([rejected])).toBeNull();
  });

  it("ignores malformed input instead of throwing", () => {
    expect(collectCurrentTodos([msg([todoWrite("t1", "nope")])])).toBeNull();
    expect(
      collectCurrentTodos([
        msg([todoWrite("t1", [{ content: 1, status: "pending" }])]),
      ]),
    ).toBeNull();
    expect(
      collectCurrentTodos([
        msg([todoWrite("t1", [{ content: "a", status: "weird" }])]),
      ]),
    ).toBeNull();
  });

  it("keeps activeForm when present and drops it when not", () => {
    expect(
      collectCurrentTodos([
        msg([todoWrite("t1", [{ ...ACTIVE, activeForm: "写迁移中" }, DONE])]),
      ]),
    ).toEqual([{ ...ACTIVE, activeForm: "写迁移中" }, DONE]);
    expect(collectCurrentTodos([msg([todoWrite("t1", [ACTIVE])])])).toEqual([
      ACTIVE,
    ]);
  });
});
