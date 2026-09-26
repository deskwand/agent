import { describe, expect, it } from "vitest";
import {
  normalizePlanDone,
  rejectTodoList,
  TODO_REJECTION_UNSETTLED_ITEMS,
} from "../../shared/todos";

const DONE = [{ content: "a", status: "completed" }];

describe("rejectTodoList 的 done 规则", () => {
  it("done 缺省 / false 时行为不变", () => {
    expect(rejectTodoList([])).toBeNull();
    expect(rejectTodoList([{ content: "a", status: "pending" }])).toBeNull();
    expect(
      rejectTodoList([{ content: "a", status: "pending" }], false),
    ).toBeNull();
  });

  it("done: true 且全部结算（completed / cancelled）才通过", () => {
    expect(rejectTodoList(DONE, true)).toBeNull();
    expect(
      rejectTodoList([{ content: "a", status: "cancelled" }], true),
    ).toBeNull();
  });

  it("done: true 但有未结算项时拒绝并给出首个违规下标", () => {
    const todos = [
      { content: "a", status: "completed" },
      { content: "b", status: "pending" },
      { content: "c", status: "in_progress" },
    ];
    expect(rejectTodoList(todos, true)).toEqual({
      reason: TODO_REJECTION_UNSETTLED_ITEMS,
      index: 1,
    });
  });

  it("既有两条规则的优先级不变（同时犯规时先报它们）", () => {
    // 空 content + 未结算 + done:true → 仍先报 emptyContent
    expect(
      rejectTodoList([{ content: "  ", status: "pending" }], true),
    ).toEqual({ reason: "emptyContent", index: 0 });
    // 多条 in_progress + 未结算 + done:true → 先报 multipleInProgress
    expect(
      rejectTodoList(
        [
          { content: "a", status: "in_progress" },
          { content: "b", status: "in_progress" },
        ],
        true,
      ),
    ).toEqual({ reason: "multipleInProgress" });
  });
});

describe("normalizePlanDone", () => {
  it("空数组上的 done 一律为 false（否则是真空成立，可被用来伪造完成）", () => {
    expect(normalizePlanDone([], true)).toBe(false);
    expect(normalizePlanDone([], false)).toBe(false);
  });

  it("有清单时只认真正的 true", () => {
    expect(normalizePlanDone(DONE, true)).toBe(true);
    expect(normalizePlanDone(DONE, false)).toBe(false);
    expect(normalizePlanDone(DONE, undefined)).toBe(false);
    expect(normalizePlanDone(DONE, "yes")).toBe(false);
  });
});
