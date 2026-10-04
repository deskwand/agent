import { describe, expect, it } from "vitest";
import { isBackchannel } from "../../renderer/utils/voice/backchannel";

describe("isBackchannel", () => {
  it("单字附和算", () => {
    for (const t of ["嗯", "哦", "呃", "对", "是", "好", "行", "啊"]) {
      expect(isBackchannel(t), t).toBe(true);
    }
  });

  it("叠字附和算", () => {
    for (const t of ["嗯嗯", "哦哦", "对对", "好的", "是啊"]) {
      expect(isBackchannel(t), t).toBe(true);
    }
  });

  it("同一个字重复也算，哪怕没进词表", () => {
    for (const t of ["嗯嗯嗯嗯", "哦哦哦", "对对对对对"]) {
      expect(isBackchannel(t), t).toBe(true);
    }
  });

  it("忽略空白与标点", () => {
    expect(isBackchannel(" 嗯 ")).toBe(true);
    expect(isBackchannel("嗯。")).toBe(true);
    expect(isBackchannel("好的！")).toBe(true);
  });

  it("真内容不算", () => {
    for (const t of [
      "帮我看看这个文件",
      "等一下",
      "不是",
      "重新生成",
      "这个不对",
    ]) {
      expect(isBackchannel(t), t).toBe(false);
    }
  });

  it("超过 6 个字一律不算，哪怕以附和开头", () => {
    expect(isBackchannel("好的那你帮我改一下这里")).toBe(false);
  });

  it("空文本不算（那是另一条分支）", () => {
    expect(isBackchannel("")).toBe(false);
    expect(isBackchannel("   ")).toBe(false);
  });
});
