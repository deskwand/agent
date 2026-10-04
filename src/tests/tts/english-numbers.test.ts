import { describe, expect, it } from "vitest";
import { expandEnglishNumbers } from "../../main/tts/english-numbers";

/**
 * 期望值即契约：英文模型没有任何 `.fst`，数字只能靠这一层读出来。
 * 改期望值前先改设计文档 §5。
 */
describe("expandEnglishNumbers", () => {
  it("spells standalone integers", () => {
    expect(expandEnglishNumbers("the 12 tests")).toBe("the twelve tests");
    expect(expandEnglishNumbers("Port 3000 is busy.")).toBe(
      "Port three thousand is busy.",
    );
    expect(expandEnglishNumbers("The 3 tests failed.")).toBe(
      "The three tests failed.",
    );
    expect(expandEnglishNumbers("1,234")).toBe(
      "one thousand two hundred thirty-four",
    );
  });

  it("spells decimals and dotted versions digit by digit", () => {
    expect(expandEnglishNumbers("3.14")).toBe("three point one four");
    expect(expandEnglishNumbers("Version 1.0.47 is ready now.")).toBe(
      "Version one point zero point four seven is ready now.",
    );
    expect(expandEnglishNumbers("1.0.47 and 2 more.")).toBe(
      "one point zero point four seven and two more.",
    );
  });

  it("spells percentages", () => {
    expect(expandEnglishNumbers("up 50% today")).toBe("up fifty percent today");
  });

  it("spells identifier-adjacent digits one by one", () => {
    expect(expandEnglishNumbers("sha256")).toBe("sha two five six");
    expect(expandEnglishNumbers("x86_64")).toBe("x eight six six four");
    expect(expandEnglishNumbers("v1.0.47")).toBe(
      "v one point zero point four seven",
    );
    expect(expandEnglishNumbers("#42")).toBe("# four two");
    expect(expandEnglishNumbers("utf-8")).toBe("utf eight");
  });

  it("spells hyphenated digit groups as cardinals", () => {
    expect(expandEnglishNumbers("It costs 10-20 dollars.")).toBe(
      "It costs ten-twenty dollars.",
    );
  });

  it("leaves text without digits alone", () => {
    expect(expandEnglishNumbers("The build failed.")).toBe("The build failed.");
    expect(expandEnglishNumbers("Run npm install, then retry.")).toBe(
      "Run npm install, then retry.",
    );
  });

  it("normalises fullwidth digits first", () => {
    expect(expandEnglishNumbers("１２ items")).toBe("twelve items");
  });

  it("documents the boundaries it does not handle", () => {
    // 已知边界（设计 §5）：日期按连字符分组读、科学计数法逐位读——不做特判
    expect(expandEnglishNumbers("2026-10-04")).toBe(
      "two thousand twenty-six-ten-four",
    );
    expect(expandEnglishNumbers("1e6")).toBe("one e six");
    expect(expandEnglishNumbers("--port 3000")).toBe("--port three thousand");
  });
});

describe("expandEnglishNumbers review fixes", () => {
  it("never emits the literal word 'undefined' for long integers", () => {
    // 16 位没有 SCALES 档位；曾经读出 "oneundefined"（信用卡号 / 长 ID 直接报废）
    expect(expandEnglishNumbers("4111111111111111")).toBe(
      "four one one one one one one one one one one one one one one one",
    );
    expect(expandEnglishNumbers("1000000000000000")).not.toContain("undefined");
    expect(expandEnglishNumbers("9007199254740991")).not.toContain("undefined");
  });

  it("treats irregular comma runs as lists, not as one number", () => {
    // 逗号两侧不是"三位分组"时按列表读：2,3 是两项，不是二十三
    expect(expandEnglishNumbers("2,3 items")).toBe("two three items");
    expect(expandEnglishNumbers("1,12 items")).toBe("one twelve items");
  });

  it("keeps the prose reading for well-formed thousands grouping", () => {
    // 已知边界（设计 §5 的取舍）：`80,443` 与 `1,234` 在语法上无法区分
    // （都是"1-3 位 + 三位组"）。散文里的千分位数字更常见，所以保留数字读法；
    // 端口列表那种场景只能靠上下文，本层不做特判。
    expect(expandEnglishNumbers("ports 80,443 are open")).toBe(
      "ports eighty thousand four hundred forty-three are open",
    );
  });

  it("still reads well-formed thousands grouping as a number", () => {
    expect(expandEnglishNumbers("1,234")).toBe(
      "one thousand two hundred thirty-four",
    );
    expect(expandEnglishNumbers("12,345")).toBe(
      "twelve thousand three hundred forty-five",
    );
  });

  it("collapses the double space a leading dot leaves behind", () => {
    expect(expandEnglishNumbers("The value is .5 seconds")).toBe(
      "The value is point five seconds",
    );
  });
});
