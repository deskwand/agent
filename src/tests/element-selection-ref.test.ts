import { describe, expect, it } from "vitest";
import {
  type ElementSelectionRef,
  toElementSelectionRefs,
} from "../shared/element-selection-ref";
import { selectedButton } from "./fixtures/element-selection";

describe("toElementSelectionRefs", () => {
  it("只留下展示需要的字段", () => {
    const [ref] = toElementSelectionRefs([selectedButton]);
    expect(ref).toEqual({
      pageUrl: "http://fixture/",
      tag: "button",
      classes: ["primary"],
      text: "开始使用",
      selector: "button.primary",
      selectorUnique: true,
      width: 132,
      height: 40,
    });
  });

  it("丢掉重字段（outerHTML / computed / matchedCss 不能进投影）", () => {
    const [ref] = toElementSelectionRefs([selectedButton]);
    const keys = Object.keys(ref);
    expect(keys).not.toContain("outerHTML");
    expect(keys).not.toContain("computed");
    expect(keys).not.toContain("matchedCss");
    expect(keys).not.toContain("rect");
  });

  it("classes 最多两个（chip 只显示得下）", () => {
    const [ref] = toElementSelectionRefs([
      { ...selectedButton, classes: ["a", "b", "c", "d"] },
    ]);
    expect(ref.classes).toEqual(["a", "b"]);
  });

  it("空输入得到空数组", () => {
    expect(toElementSelectionRefs([])).toEqual([]);
  });

  it("投影自洽：类型可被独立引用", () => {
    const ref: ElementSelectionRef = toElementSelectionRefs([
      selectedButton,
    ])[0];
    expect(ref.selector).toBe("button.primary");
  });
});
