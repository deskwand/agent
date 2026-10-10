import { describe, expect, it } from "vitest";
import { mergePendingAppend } from "../../renderer/utils/pending-editor-append";

describe("追加语义", () => {
  it("空输入框 → 直接写入，不留前导换行", () => {
    expect(mergePendingAppend("", "一条想法")).toBe("一条想法");
  });

  it("已有草稿 → 换行追加，草稿一字不动", () => {
    expect(mergePendingAppend("我正在写的一半", "一条想法")).toBe(
      "我正在写的一半\n一条想法",
    );
  });

  it("已有草稿且结尾是换行 → 不叠加空行", () => {
    expect(mergePendingAppend("草稿\n", "一条想法")).toBe("草稿\n一条想法");
  });

  it("纯空白草稿视为空", () => {
    expect(mergePendingAppend("   \n", "一条想法")).toBe("一条想法");
  });
});
