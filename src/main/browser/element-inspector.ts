/**
 * @module main/browser/element-inspector
 *
 * Design Mode v1 的纯函数层：把 CDP 的原始响应裁剪成喂给模型的
 * `ElementSelection`。**不做任何 CDP 调用** —— 那些在 BrowserViewManager 里，
 * 这里只做转换，因此可以脱离 Electron 单测。
 */
import type {
  ElementRect,
  ElementSelection,
  MatchedCssRule,
} from "../../shared/ipc-types";

export const TEXT_LIMIT = 200;
export const OUTER_HTML_LIMIT = 1200;
export const SIBLING_LIMIT = 6;
export const MATCHED_CSS_LIMIT = 5;

/**
 * computed style 白名单。全量 300+ 个属性会把信号淹掉；
 * 这里只留"能解释一个元素长什么样"的那批。
 *
 * CDP computedStyle 往往只列 longhand；PageProbe 补充下列所需简写。
 * 刻意不收录简写与其长写的重复项（`margin` 与四个 `margin-*`、`padding` 与四个
 * `padding-*`、`border` 与 `border-width/style/color`）——它们在 `getComputedStyle`
 * 里都有值，等于同一信息发两遍，而每个字段都随着消息持久化。同理不收 `font-family`
 * （回退字体列表可能几十字符）与 `background-image`（绝大多数元素恒为 `none`）。
 */
export const COMPUTED_STYLE_WHITELIST: readonly string[] = [
  // 盒模型
  "display",
  "position",
  "width",
  "height",
  "box-sizing",
  "overflow",
  "margin",
  "padding",
  "gap",
  // 布局
  "flex-direction",
  "flex-wrap",
  "justify-content",
  "align-items",
  "grid-template-columns",
  "grid-template-rows",
  // 视觉
  "color",
  "background-color",
  "border",
  "border-radius",
  "box-shadow",
  "opacity",
  "transform",
  "z-index",
  // 文字
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
] as const;

const WHITELIST_SET = new Set(COMPUTED_STYLE_WHITELIST);

/** 截断到 limit 个字符；被截断时末位是省略号（总长度恒等于 limit）。 */
export function clampText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}

const DATA_URL_ATTR = /(\s(?:src|href|srcset)=")((?:data|blob):[^"]*)"/gi;
/**
 * 120 字符以上的 `data:` / `blob:` 串，不限定属性名。
 * 为什么需要第二条：内联样式（`style="background-image:url(data:…)"`）、
 * `poster`、各 `data-*` 里同样能塞进一个内联 base64，而原来的规则只认
 * `src|href|srcset`——那个把后续属性挤出截断窗口的坑对 inline style 仍然是开的。
 */
const LONG_DATA_URL = /(?:data|blob):[^"'\s)]{120,}/gi;
// 输入仅来自 DOM.getOuterHTML（已由浏览器序列化），不是任意损坏的 HTML。
// 先分离完整 input 标签，再检查所有属性，不能假设 type 在 value 前。
const INPUT_TAG = /<input\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
const INPUT_ATTR =
  /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function stripPasswordValue(tag: string): string {
  const attributes = tag.slice(6, -1);
  const isPassword = Array.from(attributes.matchAll(INPUT_ATTR)).some(
    (match) =>
      match[1].toLowerCase() === "type" &&
      (match[2] ?? match[3] ?? match[4] ?? "").toLowerCase() === "password",
  );
  if (!isPassword) return tag;
  return `<input${attributes.replace(INPUT_ATTR, (full, name: string) =>
    name.toLowerCase() === "value" ? "" : full,
  )}>`;
}

/**
 * outerHTML 里有两种东西会吃掉整段预算或泄密：
 * 1. `data:` / `blob:` 属性值（一个内联 base64 图片就能占满 1200 字符，
 *    把后面所有属性挤出截断窗口）——折叠成 `data:…(N chars)`。
 * 2. `<input type="password">` 的 `value` 是"默认值"而非用户输入，
 *    但默认值也可能是真密码 —— 直接删掉该属性。
 */
export function sanitizeOuterHtml(html: string): string {
  const folded = html
    .replace(
      DATA_URL_ATTR,
      (_match, prefix: string, url: string) =>
        `${prefix}${url.slice(0, 5)}…(${url.length} chars)"`,
    )
    // 第二条规则跑在第一条之后：被折叠过的串已经很短，不会再命中。
    .replace(
      LONG_DATA_URL,
      (url: string) => `${url.slice(0, 5)}…(${url.length} chars)`,
    );
  return folded.replace(INPUT_TAG, stripPasswordValue);
}

export function pickComputedStyles(
  entries: Array<{ name: string; value: string }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of entries) {
    if (WHITELIST_SET.has(entry.name)) out[entry.name] = entry.value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// CDP 响应 → ElementSelection
// ---------------------------------------------------------------------------

/** 页面内探针（由 Runtime.callFunctionOn 在页面里算出来）的结果。 */
export interface PageProbe {
  selector: string;
  selectorUnique: boolean;
  domPath: string;
  text: string;
  /** CDP computedStyle 通常只列 longhand，探针补充所需简写。 */
  computedShorthands?: Array<{ name: string; value: string }>;
}

export interface InspectorInput {
  pageUrl: string;
  pageTitle: string;
  probe: PageProbe;
  /** DOM.describeNode 的 node；null 表示节点已消失 */
  node: { nodeName: string; attributes: string[] } | null;
  outerHtml: string;
  /** DOM.getBoxModel 的 border quad（8 个数） */
  boxModel: { border: number[] } | null;
  computedEntries: Array<{ name: string; value: string }>;
  /** CSS.getMatchedStylesForNode 的原始返回 */
  matchedStyles: unknown;
  /** styleSheetId → sourceURL，由 CSS.styleSheetAdded 累积 */
  stylesheetHeaders: Map<string, string>;
  axNode: { role?: { value?: string }; name?: { value?: string } } | null;
  viewport: { width: number; height: number; dpr: number };
  scroll: { x: number; y: number };
  parent: {
    selector: string;
    tag: string;
    display: string;
    gap?: string;
    rect: ElementRect;
  } | null;
  siblings: Array<{ tag: string; classes: string[]; rect: ElementRect }>;
}

/** CDP 的 quad 是 4 个角的 x,y 依次排列（8 个数）。 */
export function quadToRect(quad: number[]): ElementRect {
  if (quad.length < 8) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(Math.max(...xs) - x),
    height: Math.round(Math.max(...ys) - y),
  };
}

/**
 * dev server 的样式表 URL 通常就是 site-root 相对路径（Vite 直接反映项目结构）。
 * 我们**不**猜文件系统路径（那需要 cwd，且 webpack / Next 下根本不成立），
 * 只把 origin 与 query 去掉，再让 agent 自己对到项目根。
 */
export function siteRelativePath(
  sourceUrl: string,
  pageUrl: string,
): string | undefined {
  try {
    const url = new URL(sourceUrl);
    const page = new URL(pageUrl);
    if (url.origin !== page.origin) return undefined;
    return url.pathname;
  } catch {
    return undefined;
  }
}

type RawCssProperty = {
  name?: string;
  value?: string;
  disabled?: boolean;
  parsedOk?: boolean;
  important?: boolean;
};
type RawCssStyle = {
  cssProperties?: RawCssProperty[];
  range?: { startLine?: number };
};
type RawMatchedRule = {
  rule?: {
    origin?: string;
    styleSheetId?: string;
    selectorList?: { text?: string; selectors?: Array<{ text?: string }> };
    style?: RawCssStyle;
  };
  matchingSelectors?: number[];
};

/**
 * CDP **不给**「哪条属性被后面的规则覆盖了」这个标记（DevTools 前端自己算），
 * 所以我们也不算：输出有限规则样本和 important 标记，computed 是最终结果。
 * 不把数组顺序标成 later wins（specificity、layer 和 important 均影响级联）。
 */
export function toMatchedCssRules(
  rawMatchedStyles: unknown,
  stylesheetHeaders: Map<string, string>,
  pageUrl: string,
): MatchedCssRule[] {
  const raw = rawMatchedStyles as {
    matchedCSSRules?: RawMatchedRule[];
    inlineStyle?: RawCssStyle;
    attributesStyle?: RawCssStyle;
  } | null;
  const declarations = (style?: RawCssStyle): string[] =>
    (style?.cssProperties ?? [])
      .filter(
        (p) =>
          p.name &&
          !p.disabled &&
          p.parsedOk !== false &&
          !p.name.startsWith("-webkit-"),
      )
      .map((p) => {
        const value = p.value ?? "";
        const important =
          p.important && !/!important\s*$/i.test(value) ? " !important" : "";
        return `${p.name}: ${value}${important}`;
      });

  const out: MatchedCssRule[] = [];
  const attributeDeclarations = declarations(raw?.attributesStyle);
  if (attributeDeclarations.length) {
    out.push({
      selector: "presentation attributes",
      origin: "attribute",
      declarations: attributeDeclarations,
    });
  }
  for (const match of raw?.matchedCSSRules ?? []) {
    const rule = match.rule;
    if (!rule || rule.origin === "user-agent") continue;
    const values = declarations(rule.style);
    if (!values.length) continue;
    const sourceUrl = rule.styleSheetId
      ? stylesheetHeaders.get(rule.styleSheetId)
      : undefined;
    const selectorIndex = match.matchingSelectors?.[0] ?? 0;
    out.push({
      selector:
        rule.selectorList?.selectors?.[selectorIndex]?.text ??
        rule.selectorList?.text ??
        "",
      // CDP StyleSheetOrigin 不是应用自己的 inline / constructed 分类。
      // 构造样式表无 URL 时仍作为 regular 规则，不伪造本地文件来源。
      origin: "regular",
      sourceUrl,
      siteRelativePath: sourceUrl
        ? siteRelativePath(sourceUrl, pageUrl)
        : undefined,
      line: rule.style?.range?.startLine,
      declarations: values,
    });
  }
  const inlineDeclarations = declarations(raw?.inlineStyle);
  if (inlineDeclarations.length) {
    out.push({
      selector: "element.style",
      origin: "inline",
      declarations: inlineDeclarations,
    });
  }
  // 这只是有上限的匹配规则样本，不声称它就是完整级联或获胜声明。
  // 保留末尾样本可避免规则多时总是只发送 reset；inline 保留在末尾。
  return out.slice(-MATCHED_CSS_LIMIT);
}

/** attributes 是 CDP 的扁平数组 [name, value, name, value, …]。 */
function attributesToPairs(
  attributes: string[],
): Array<{ name: string; value: string }> {
  const pairs: Array<{ name: string; value: string }> = [];
  for (let i = 0; i + 1 < attributes.length; i += 2) {
    pairs.push({ name: attributes[i], value: attributes[i + 1] });
  }
  return pairs;
}

export function buildElementSelection(
  input: InspectorInput,
): ElementSelection | null {
  if (!input.node) return null;

  const pairs = attributesToPairs(input.node.attributes);
  const classValue = pairs.find((p) => p.name === "class")?.value.trim() ?? "";

  return {
    pageUrl: input.pageUrl,
    pageTitle: input.pageTitle,
    tag: input.node.nodeName.toLowerCase(),
    classes: classValue ? classValue.split(/\s+/).filter(Boolean) : [],
    text: clampText(input.probe.text, TEXT_LIMIT),
    outerHTML: clampText(sanitizeOuterHtml(input.outerHtml), OUTER_HTML_LIMIT),
    role: input.axNode?.role?.value ?? null,
    accessibleName: input.axNode?.name?.value ?? "",
    selector: input.probe.selector,
    selectorUnique: input.probe.selectorUnique,
    domPath: input.probe.domPath,
    matchedCss: toMatchedCssRules(
      input.matchedStyles,
      input.stylesheetHeaders,
      input.pageUrl,
    ),
    computed: pickComputedStyles([
      ...input.computedEntries,
      ...(input.probe.computedShorthands ?? []),
    ]),
    rect: input.boxModel
      ? quadToRect(input.boxModel.border)
      : { x: 0, y: 0, width: 0, height: 0 },
    parent: input.parent,
    siblings: input.siblings.slice(0, SIBLING_LIMIT),
    viewport: input.viewport,
    scroll: input.scroll,
  };
}

// ---------------------------------------------------------------------------
// 拾取态
// ---------------------------------------------------------------------------

export type PickerEvent =
  | "start"
  | "picked"
  | "stop"
  /** 用户在页面里按 Esc —— Chromium 自己退出检查模式并回调过来 */
  | "canceled"
  /** 视图不可用（导航走了 / 面板关了 / 视图销毁） */
  | "view-gone";

/**
 * 拾取态是**一个布尔**，不值得上状态机框架 —— 但抽取成纯函数，
 * 是因为「Esc 也要关」这条最容易漏（漏了就是页面已退出、工具栏还亮着）。
 */
export function nextPickerActive(
  current: boolean,
  event: PickerEvent,
): boolean {
  switch (event) {
    case "start":
      return true;
    case "picked":
      return current;
    case "stop":
    case "canceled":
    case "view-gone":
      return false;
  }
}
