import { describe, expect, it } from "vitest";
import { collectCurrentPlan } from "../../renderer/utils/current-todos";
import { normalizePlanDone } from "../../shared/todos";
import type { ContentBlock, Message } from "../../renderer/types";

function msg(content: ContentBlock[]): Message {
  return { id: "m", sessionId: "s1", role: "assistant", timestamp: 1, content };
}

function todoWrite(id: string, todos: unknown): ContentBlock {
  return { type: "tool_use", id, name: "todo_write", input: { todos } };
}

const DONE = { content: "建表", status: "completed" };
const ACTIVE = { content: "写迁移", status: "in_progress" };

describe("collectCurrentPlan", () => {
  it("returns null when there is no todo_write at all", () => {
    expect(collectCurrentPlan(undefined)).toBeNull();
    expect(collectCurrentPlan([])).toBeNull();
    expect(
      collectCurrentPlan([
        msg([{ type: "text", text: "hi" }]),
        msg([{ type: "tool_use", id: "t1", name: "bash", input: {} }]),
      ]),
    ).toBeNull();
  });

  it("returns the last valid list when several calls exist", () => {
    const first = msg([todoWrite("t1", [DONE])]);
    const second = msg([todoWrite("t2", [DONE, ACTIVE])]);
    expect(collectCurrentPlan([first, second])).toEqual({
      todos: [DONE, ACTIVE],
      done: false,
    });
    // 顺序反过来也必须取"最后一条"，而不是"第一条"
    expect(collectCurrentPlan([second, first])).toEqual({
      todos: [DONE],
      done: false,
    });
  });

  it("returns an empty array when the last call cleared the list", () => {
    expect(collectCurrentPlan([msg([todoWrite("t1", [])])])).toEqual({
      todos: [],
      done: false,
    });
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
    expect(collectCurrentPlan([valid, rejected])).toEqual({
      todos: [DONE],
      done: false,
    });

    // 只有被拒的那条 → 没有生效清单
    expect(collectCurrentPlan([rejected])).toBeNull();
  });

  it("ignores malformed input instead of throwing", () => {
    expect(collectCurrentPlan([msg([todoWrite("t1", "nope")])])).toBeNull();
    expect(
      collectCurrentPlan([
        msg([todoWrite("t1", [{ content: 1, status: "pending" }])]),
      ]),
    ).toBeNull();
    expect(
      collectCurrentPlan([
        msg([todoWrite("t1", [{ content: "a", status: "weird" }])]),
      ]),
    ).toBeNull();
  });

  it("keeps activeForm when present and drops it when not", () => {
    expect(
      collectCurrentPlan([
        msg([todoWrite("t1", [{ ...ACTIVE, activeForm: "写迁移中" }, DONE])]),
      ]),
    ).toEqual({
      todos: [{ ...ACTIVE, activeForm: "写迁移中" }, DONE],
      done: false,
    });
    expect(collectCurrentPlan([msg([todoWrite("t1", [ACTIVE])])])).toEqual({
      todos: [ACTIVE],
      done: false,
    });
  });
  it("reads the done flag from the same call", () => {
    const withDone = msg([
      {
        type: "tool_use",
        id: "t1",
        name: "todo_write",
        input: { todos: [{ content: "a", status: "completed" }], done: true },
      },
    ]);
    expect(collectCurrentPlan([withDone])).toEqual({
      todos: [{ content: "a", status: "completed" }],
      done: true,
    });
  });

  it("normalizePlanDone 是两侧共用的那一条规则", () => {
    expect(normalizePlanDone([], true)).toBe(false);
    expect(
      normalizePlanDone([{ content: "a", status: "completed" }], true),
    ).toBe(true);
    expect(
      normalizePlanDone([{ content: "a", status: "completed" }], undefined),
    ).toBe(false);
  });

  it("normalizes done on an empty array away (it would be vacuously true)", () => {
    const cleared = msg([
      {
        type: "tool_use",
        id: "t1",
        name: "todo_write",
        input: { todos: [], done: true },
      },
    ]);
    expect(collectCurrentPlan([cleared])).toEqual({ todos: [], done: false });
  });

  it("镜像 schema 级限制：超限清单不算生效（工具侧会被 TypeBox 拒）", () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => ({
      content: `t${i}`,
      status: "completed",
    }));
    expect(collectCurrentPlan([msg([todoWrite("t1", tooMany)])])).toBeNull();
    expect(
      collectCurrentPlan([
        msg([
          todoWrite("t2", [{ content: "x".repeat(201), status: "pending" }]),
        ]),
      ]),
    ).toBeNull();
  });

  it("skips a call that declares done while items are unsettled", () => {
    const bad = msg([
      {
        type: "tool_use",
        id: "t2",
        name: "todo_write",
        input: { todos: [{ content: "a", status: "pending" }], done: true },
      },
    ]);
    const good = msg([
      {
        type: "tool_use",
        id: "t1",
        name: "todo_write",
        input: { todos: [{ content: "a", status: "completed" }] },
      },
    ]);
    // 被拒的调用不生效 → 回退到上一条有效清单
    expect(collectCurrentPlan([good, bad])).toEqual({
      todos: [{ content: "a", status: "completed" }],
      done: false,
    });
    expect(collectCurrentPlan([bad])).toBeNull();
  });
});
