import type { ElementSelection } from "../../shared/ipc-types";

/**
 * 共享的元素拾取快照。用具体字段而不是空对象强转，避免字段漏传时
 * 断言（toEqual(selectedButton)）两边一起错、测试假通过。
 */
export const selectedButton: ElementSelection = {
  pageUrl: "http://fixture/",
  pageTitle: "Fixture",
  tag: "button",
  classes: ["primary"],
  text: "开始使用",
  outerHTML: '<button class="primary">开始使用</button>',
  role: "button",
  accessibleName: "开始使用",
  selector: "button.primary",
  selectorUnique: true,
  domPath: "body > button",
  matchedCss: [],
  computed: { "border-radius": "12px" },
  rect: { x: 10, y: 20, width: 132, height: 40 },
  parent: null,
  siblings: [],
  viewport: { width: 1440, height: 900, dpr: 1 },
  scroll: { x: 0, y: 0 },
};
