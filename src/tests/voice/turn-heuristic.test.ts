import { describe, expect, it } from "vitest";
import { isTurnComplete } from "../../renderer/utils/voice/turn-heuristic";

describe("isTurnComplete", () => {
  it("句末标点 → 说完了", () => {
    for (const t of ["就这样吧。", "可以了吗？", "太好了！", "好的。"]) {
      expect(isTurnComplete(t), t).toBe(true);
    }
  });

  it("句中标点 → 没说完", () => {
    // 分号尤其要盯：它本身就是"还有下文"的信号，拿它当句末就是从半句话里切人。
    for (const t of [
      "我想想，",
      "如果这样的话、",
      "首先是，",
      "因为：",
      "先做这个；",
    ]) {
      expect(isTurnComplete(t), t).toBe(false);
    }
  });

  it("裸字结尾 → 没说完", () => {
    for (const t of ["我想想", "帮我看一下这个文件", "那个"]) {
      expect(isTurnComplete(t), t).toBe(false);
    }
  });

  it("省略号 → 没说完", () => {
    for (const t of ["我想想……", "那个嘛...", "嗯嗯……"]) {
      expect(isTurnComplete(t), t).toBe(false);
    }
  });

  it("空文本 → 没说完（交给硬上限兜底）", () => {
    expect(isTurnComplete("")).toBe(false);
    expect(isTurnComplete("   ")).toBe(false);
  });
});
