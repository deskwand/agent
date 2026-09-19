// contenteditable 编辑器的内容层：token 节点构造、纯文本序列化、内容重建、光标。
//
// 全部是纯 DOM 操作、不依赖 React —— 非受控编辑期间 React 不碰 DOM（设计文档 §5.2），
// 这里就是"碰 DOM"的唯一出口，所以能脱离组件单独测试。
import {
  REFERENCE_TOKEN_ICON_MARKUP,
  type ReferenceTokenKind,
} from "../components/reference-token-visuals";
import {
  resolveLeadingToken,
  type ReferenceTokenSegment,
} from "./reference-tokens";

/**
 * 必须与 components/ReferenceToken.tsx 的 BASE_CLASS 保持一致。
 *
 * 不要改回 inline-flex：容器的基线会变成首个 flex item（svg）的底边，整个 token
 * 会被抬起约 2px（见 globals.css 里 .reference-token-icon 的说明与设计文档 §13）。
 * whitespace-nowrap 让 token 不被换行拆开。
 */
const TOKEN_CLASS = "font-medium text-mention whitespace-nowrap";

/** token 元素上的原文标记：序列化时取它，屏幕上显示的是它的渲染结果。 */
export const TOKEN_RAW_ATTR = "data-raw";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 构造一个原子 token 节点。
 *
 * `contenteditable="false"` 让 Chromium 把它当整体对象：光标停在其后按退格整块删除、
 * 方向键跨过、鼠标点击吸附到最近的边界 —— "整块语义"由浏览器自带，不写光标吸附逻辑。
 */
export function createReferenceTokenElement(
  segment: ReferenceTokenSegment,
): HTMLElement {
  const kind: ReferenceTokenKind = segment.kind;
  const el = document.createElement("span");
  el.setAttribute("contenteditable", "false");
  el.setAttribute(TOKEN_RAW_ATTR, segment.raw);
  // 命令的 chip 可能显示的是 display_name（「翻译成英文」），悬停给回要输入的原样
  if (segment.kind === "command") el.setAttribute("title", segment.raw);
  el.setAttribute("class", TOKEN_CLASS);
  el.innerHTML =
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round" class="reference-token-icon mr-1 h-3.5 w-3.5" aria-hidden="true">` +
    `${REFERENCE_TOKEN_ICON_MARKUP[kind]}</svg><span>${escapeHtml(segment.label)}</span>`;
  return el;
}

/** 把编辑器的 DOM 序列化回纯文本：token 取 data-raw，其余取文本内容。 */
export function serializeEditor(root: HTMLElement | null): string {
  if (!root) return "";
  let out = "";
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
      continue;
    }
    if (!(node instanceof HTMLElement)) continue;
    const raw = node.getAttribute(TOKEN_RAW_ATTR);
    if (raw !== null) {
      out += raw;
      continue;
    }
    out += node.tagName === "BR" ? "\n" : (node.textContent ?? "");
  }
  return out;
}

/** 清空编辑器并按 text 重建内容 —— 行首的引用会渲染成 token。 */
export function setEditorFromText(
  root: HTMLElement | null,
  text: string,
  commandLabels: ReadonlyMap<string, string> = new Map<string, string>(),
): void {
  if (!root) return;
  root.textContent = "";
  if (!text) return;

  const token = resolveLeadingToken(text, commandLabels);
  if (!token) {
    root.appendChild(document.createTextNode(text));
    return;
  }

  root.appendChild(createReferenceTokenElement(token));
  const rest = text.slice(token.raw.length);
  if (rest) root.appendChild(document.createTextNode(rest));
}

/**
 * 把不在行首的 token 退回成纯文本。
 *
 * 与气泡渲染同一条规则：token 只存在于能生效的位置。可达路径是"在 token 之前粘贴文字"。
 */
export function degradeNonLeadingTokens(root: HTMLElement | null): void {
  if (!root) return;
  const tokens = Array.from(
    root.querySelectorAll<HTMLElement>(`[${TOKEN_RAW_ATTR}]`),
  );
  for (const token of tokens) {
    if (token === root.firstChild) continue;
    const raw = token.getAttribute(TOKEN_RAW_ATTR) ?? "";
    token.replaceWith(document.createTextNode(raw));
  }
}

/** 光标移到内容末尾（插入 token 之后调用）。 */
export function placeCaretAtEnd(root: HTMLElement | null): void {
  if (!root) return;
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
}

function textLength(node: Node): number {
  if (node instanceof HTMLElement) {
    const raw = node.getAttribute(TOKEN_RAW_ATTR);
    if (raw !== null) return raw.length;
    // <br> 在 serializeEditor 里换算成一个 \n，这里必须同账 —— 否则两套坐标不一致，
    // 带换行的内容插入 token 时切片会错位。
    if (node.tagName === "BR") return 1;
  }
  return node.textContent?.length ?? 0;
}

/** node 之前（同一 root 内、逐层向上）所有兄弟节点的纯文本长度之和。 */
function precedingLength(node: Node, root: HTMLElement): number {
  let total = 0;
  let current: Node | null = node;
  while (current && current !== root) {
    for (const sibling of Array.from(current.parentNode?.childNodes ?? [])) {
      if (sibling === current) break;
      total += textLength(sibling);
    }
    current = current.parentNode;
  }
  return total;
}

/**
 * 光标在**纯文本坐标**里的偏移 —— 与 serializeEditor 同一套坐标（token 按 data-raw 长度计）。
 *
 * 为什么必须有它：`selectionStart` / `selectionEnd` / `setSelectionRange` 是
 * HTMLTextAreaElement 专有 API，在 `<div>` 上都是 `undefined`。所有读光标位置的代码
 * （斜杠触发判断、输入法过滤、"斜杠被删则关菜单"）都得改走这里。
 *
 * 两种落点都要处理：
 * - 落在文本节点里：本节点偏移 + 它之前所有节点的长度
 * - 落在元素上（点空白处、insertLineBreak 之后、placeCaretAtEnd 之后）：此时 startOffset
 *   是**子节点下标**，换算成"该下标之前所有子节点的长度之和"。漏掉这一支会让光标在末尾时恒为 0。
 *
 * 光标不在编辑器内（焦点跑到菜单上）时返回 0 —— 调用方按"开头"处理，安全。
 */
export function getCaretOffset(root: HTMLElement | null): number {
  if (!root) return 0;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return 0;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return 0;

  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    return precedingLength(range.startContainer, root) + range.startOffset;
  }

  const children = Array.from(range.startContainer.childNodes);
  let inner = 0;
  for (let i = 0; i < Math.min(range.startOffset, children.length); i++) {
    inner += textLength(children[i]);
  }
  return precedingLength(range.startContainer, root) + inner;
}
