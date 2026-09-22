import { describe, expect, it } from "vitest";
import {
  clampText,
  pickComputedStyles,
  sanitizeOuterHtml,
  OUTER_HTML_LIMIT,
  TEXT_LIMIT,
} from "../main/browser/element-inspector";

describe("clampText", () => {
  it("短文本原样返回", () => {
    expect(clampText("开始使用", TEXT_LIMIT)).toBe("开始使用");
  });

  it("超长文本按上限截断并带省略号", () => {
    const out = clampText("a".repeat(TEXT_LIMIT + 50), TEXT_LIMIT);
    expect(out).toHaveLength(TEXT_LIMIT);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("sanitizeOuterHtml", () => {
  it("把 data: 属性值换成字节数占位，后面的属性不被吃掉", () => {
    const html = `<img src="data:image/png;base64,${"A".repeat(5000)}" alt="x">`;
    const out = sanitizeOuterHtml(html);
    expect(out).toContain("data:…(");
    expect(out).toContain('alt="x"');
    expect(out.length).toBeLessThan(OUTER_HTML_LIMIT);
  });

  it("把 blob: 属性值同样折叠", () => {
    const out = sanitizeOuterHtml('<img src="blob:http://localhost/abc123">');
    expect(out).toContain("blob:…");
  });

  it("内联样式里的长 data URL 同样折叠，不吃掉后续属性", () => {
    const html = `<div style="background-image:url(data:image/png;base64,${"A".repeat(400)})" data-testid="hero">文本</div>`;
    const out = sanitizeOuterHtml(html);
    expect(out).toContain("data:…(");
    expect(out).toContain('data-testid="hero"');
    expect(out).toContain("文本");
    expect(out.length).toBeLessThan(200);
  });

  it("剔除 password 输入框的 value", () => {
    const out = sanitizeOuterHtml('<input type="password" value="hunter2">');
    expect(out).not.toContain("hunter2");
  });

  it.each([
    '<input value="hunter2" type="password">',
    "<input value='hunter2' type='password'>",
    '<INPUT VALUE="hunter2" TYPE="PASSWORD">',
    '<input data-note="type=password" value="hunter2" type="password">',
  ])("password value 与属性顺序无关：%s", (html) => {
    expect(sanitizeOuterHtml(html)).not.toContain("hunter2");
  });

  it("保留普通输入框的 value", () => {
    const out = sanitizeOuterHtml('<input type="text" value="ok">');
    expect(out).toContain('value="ok"');
  });
});

describe("pickComputedStyles", () => {
  it("只保留白名单属性", () => {
    const out = pickComputedStyles([
      { name: "border-radius", value: "12px" },
      { name: "-webkit-locale", value: "en" },
      { name: "display", value: "flex" },
    ]);
    expect(out).toEqual({ "border-radius": "12px", display: "flex" });
  });

  it("空输入得到空对象", () => {
    expect(pickComputedStyles([])).toEqual({});
  });
});

import {
  buildElementSelection,
  quadToRect,
  siteRelativePath,
  toMatchedCssRules,
  type InspectorInput,
} from "../main/browser/element-inspector";

describe("quadToRect", () => {
  it("把 8 个坐标折成 rect", () => {
    expect(quadToRect([10, 20, 110, 20, 110, 60, 10, 60])).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 40,
    });
  });

  it("空 quad 得到零矩形", () => {
    expect(quadToRect([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe("siteRelativePath", () => {
  it("去掉 origin 与 query", () => {
    expect(
      siteRelativePath(
        "http://localhost:5173/src/styles/button.css?t=1712",
        "http://localhost:5173/dashboard",
      ),
    ).toBe("/src/styles/button.css");
  });

  it("不同 origin 时返回 undefined", () => {
    expect(
      siteRelativePath(
        "https://cdn.example.com/a.css",
        "http://localhost:5173/dashboard",
      ),
    ).toBeUndefined();
  });

  it("非法 url 返回 undefined", () => {
    expect(siteRelativePath("not a url", "http://x/")).toBeUndefined();
  });
});

describe("toMatchedCssRules", () => {
  const headers = new Map([
    ["sheet-1", "http://localhost:5173/src/styles/button.css"],
  ]);

  it("丢弃 user-agent 规则", () => {
    const out = toMatchedCssRules(
      {
        matchedCSSRules: [
          {
            rule: {
              origin: "user-agent",
              selectorList: { text: "button" },
              style: {
                cssProperties: [{ name: "margin", value: "0px" }],
                range: { startLine: 3 },
              },
            },
          },
        ],
      },
      headers,
      "http://localhost:5173/dashboard",
    );
    expect(out).toEqual([]);
  });

  it("保留常规规则并解析出文件与行号", () => {
    const out = toMatchedCssRules(
      {
        matchedCSSRules: [
          {
            rule: {
              origin: "regular",
              styleSheetId: "sheet-1",
              selectorList: { selectors: [{ text: ".btn-primary" }] },
              style: {
                cssProperties: [
                  { name: "border-radius", value: "12px" },
                  { name: "background-color", value: "rgb(59,130,246)" },
                  { name: "-webkit-locale", value: "en" },
                ],
                range: { startLine: 41 },
              },
            },
          },
        ],
      },
      headers,
      "http://localhost:5173/dashboard",
    );
    expect(out).toHaveLength(1);
    expect(out[0].selector).toBe(".btn-primary");
    expect(out[0].sourceUrl).toBe(
      "http://localhost:5173/src/styles/button.css",
    );
    expect(out[0].siteRelativePath).toBe("/src/styles/button.css");
    expect(out[0].line).toBe(41);
    expect(out[0].declarations).toEqual([
      "border-radius: 12px",
      "background-color: rgb(59,130,246)",
    ]);
  });

  it("header 缺失时保留行号但没有文件", () => {
    const out = toMatchedCssRules(
      {
        matchedCSSRules: [
          {
            rule: {
              origin: "regular",
              styleSheetId: "unknown",
              selectorList: { text: ".a" },
              style: {
                cssProperties: [{ name: "color", value: "red" }],
                range: { startLine: 7 },
              },
            },
          },
        ],
      },
      headers,
      "http://localhost:5173/dashboard",
    );
    expect(out[0].sourceUrl).toBeUndefined();
    expect(out[0].line).toBe(7);
  });

  it("内联、属性样式与 important 来自独立 CDP 字段", () => {
    const out = toMatchedCssRules(
      {
        attributesStyle: { cssProperties: [{ name: "width", value: "20px" }] },
        inlineStyle: {
          cssProperties: [
            { name: "color", value: "red", important: true },
            { name: "display", value: "none", disabled: true },
          ],
        },
      },
      headers,
      "http://localhost:5173/",
    );
    expect(out.map((rule) => rule.origin)).toEqual(["attribute", "inline"]);
    expect(out[1].declarations).toEqual(["color: red !important"]);
  });

  it("上限 5 条", () => {
    const rules = Array.from({ length: 8 }, (_, i) => ({
      rule: {
        origin: "regular",
        styleSheetId: "sheet-1",
        selectorList: { text: `.c${i}` },
        style: {
          cssProperties: [{ name: "color", value: "red" }],
          range: { startLine: i },
        },
      },
    }));
    const out = toMatchedCssRules(
      { matchedCSSRules: rules },
      headers,
      "http://localhost:5173/dashboard",
    );
    expect(out).toHaveLength(5);
  });
});

describe("buildElementSelection", () => {
  const baseInput = (): InspectorInput => ({
    pageUrl: "http://localhost:5173/dashboard",
    pageTitle: "Dashboard",
    probe: {
      selector: "main > button.btn-primary",
      selectorUnique: true,
      domPath: "body > div#root > main > button:nth-child(3)",
      text: "开始使用",
    },
    node: {
      nodeName: "BUTTON",
      attributes: [
        "id",
        "upgrade",
        "class",
        "btn btn-primary",
        "data-testid",
        "cta",
      ],
    },
    outerHtml:
      '<button id="upgrade" class="btn btn-primary" data-testid="cta">开始使用</button>',
    boxModel: { border: [816, 214, 948, 214, 948, 254, 816, 254] },
    computedEntries: [
      { name: "border-radius", value: "12px" },
      { name: "display", value: "flex" },
    ],
    matchedStyles: { matchedCSSRules: [] },
    stylesheetHeaders: new Map<string, string>(),
    axNode: { role: { value: "button" }, name: { value: "开始使用" } },
    viewport: { width: 1440, height: 900, dpr: 2 },
    scroll: { x: 0, y: 120 },
    parent: null,
    siblings: [],
  });

  it("产出所有关键字段", () => {
    const out = buildElementSelection(baseInput());
    expect(out).not.toBeNull();
    expect(out!.tag).toBe("button");
    expect(out!.classes).toEqual(["btn", "btn-primary"]);
    expect(out!.role).toBe("button");
    expect(out!.accessibleName).toBe("开始使用");
    expect(out!.rect).toEqual({ x: 816, y: 214, width: 132, height: 40 });
    expect(out!.computed).toEqual({ "border-radius": "12px", display: "flex" });
    expect(out!.selectorUnique).toBe(true);
  });

  it("CDP 不返回简写时使用页面探针补齐圆角", () => {
    const input = baseInput();
    input.computedEntries = [{ name: "border-top-left-radius", value: "12px" }];
    input.probe.computedShorthands = [{ name: "border-radius", value: "12px" }];
    expect(buildElementSelection(input)!.computed["border-radius"]).toBe(
      "12px",
    );
  });

  it("缺失 boxModel 不抛异常", () => {
    const input = baseInput();
    input.boxModel = null;
    expect(buildElementSelection(input)!.rect).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });

  it("selectorUnique 为 false 时原样带出", () => {
    const input = baseInput();
    input.probe.selectorUnique = false;
    expect(buildElementSelection(input)!.selectorUnique).toBe(false);
  });

  it("缺少节点信息时返回 null（节点已消失）", () => {
    const input = baseInput();
    input.node = null;
    expect(buildElementSelection(input)).toBeNull();
  });

  it("siblings 按上限 6 截断", () => {
    const input = baseInput();
    input.siblings = Array.from({ length: 9 }, (_, i) => ({
      tag: "button",
      classes: [`s${i}`],
      rect: { x: i, y: 0, width: 10, height: 10 },
    }));
    expect(buildElementSelection(input)!.siblings).toHaveLength(6);
  });
});

import { nextPickerActive } from "../main/browser/element-inspector";

describe("nextPickerActive", () => {
  it("start 激活", () => {
    expect(nextPickerActive(false, "start")).toBe(true);
  });

  it("pick 之后保持激活（多选的前提）", () => {
    expect(nextPickerActive(true, "picked")).toBe(true);
  });

  it("stop 关闭", () => {
    expect(nextPickerActive(true, "stop")).toBe(false);
  });

  it("页面内按 Esc（inspectModeCanceled）关闭", () => {
    expect(nextPickerActive(true, "canceled")).toBe(false);
  });

  it("视图消失时关闭", () => {
    expect(nextPickerActive(true, "view-gone")).toBe(false);
  });

  it("已关闭状态下 stop / canceled / picked 都不抛异常且保持关闭", () => {
    for (const event of ["stop", "canceled", "picked", "view-gone"] as const) {
      expect(nextPickerActive(false, event)).toBe(false);
    }
  });
});
