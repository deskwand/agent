import { describe, expect, it } from "vitest";
import {
  addElementSelection,
  removeElementSelection,
  selectionKey,
} from "../../renderer/utils/element-selections";
import type { ElementSelection } from "../../shared/ipc-types";

function selection(pageUrl: string, selector: string): ElementSelection {
  return {
    pageUrl,
    pageTitle: "",
    tag: "button",
    classes: [],
    text: "",
    outerHTML: "",
    role: null,
    accessibleName: "",
    selector,
    selectorUnique: true,
    domPath: "",
    matchedCss: [],
    computed: {},
    rect: { x: 0, y: 0, width: 0, height: 0 },
    parent: null,
    siblings: [],
    viewport: { width: 0, height: 0, dpr: 1 },
    scroll: { x: 0, y: 0 },
  };
}

describe("element selections list", () => {
  it("同一元素重复 pick 只留一张，且返回原数组", () => {
    const first = selection("http://a/", "#x");
    const list = addElementSelection([], first);
    expect(addElementSelection(list, first)).toBe(list);
  });

  it("同 selector 但不同页面算两个元素", () => {
    const list = addElementSelection([], selection("http://a/", "#x"));
    expect(
      addElementSelection(list, selection("http://b/", "#x")),
    ).toHaveLength(2);
  });

  it("按 key 删除", () => {
    const first = selection("http://a/", "#x");
    const list = addElementSelection(
      addElementSelection([], first),
      selection("http://a/", "#y"),
    );
    expect(removeElementSelection(list, selectionKey(first))).toHaveLength(1);
  });

  it("删不存在的 key 不改列表长度", () => {
    const list = addElementSelection([], selection("http://a/", "#x"));
    expect(removeElementSelection(list, "nope")).toHaveLength(1);
  });
});
