// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  createReferenceTokenElement,
  degradeNonLeadingTokens,
  escapeHtml,
  getCaretOffset,
  serializeEditor,
  setEditorFromText,
  TOKEN_RAW_ATTR,
} from "../../renderer/utils/editor-content";

function editor(): HTMLDivElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

function setCaretAtEnd(root: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

describe("createReferenceTokenElement", () => {
  it("技能 token 是原子节点，data-raw 是原文，显示的是纯名称", () => {
    const el = createReferenceTokenElement({
      kind: "skill",
      name: "apple-design",
      raw: "/skill:apple-design",
    });
    expect(el.getAttribute("contenteditable")).toBe("false");
    expect(el.getAttribute(TOKEN_RAW_ATTR)).toBe("/skill:apple-design");
    expect(el.textContent).toBe("apple-design");
    expect(el.querySelector("svg")).not.toBeNull();
    expect(el.className).toContain("text-mention");
  });

  it("命令 token 显示含斜杠的原文", () => {
    const el = createReferenceTokenElement({
      kind: "command",
      name: "compact",
      raw: "/compact",
    });
    expect(el.textContent).toBe("/compact");
  });

  it("名字里的尖括号被转义，不会注入标签", () => {
    const el = createReferenceTokenElement({
      kind: "skill",
      name: "<img src=x>",
      raw: "/skill:<img src=x>",
    });
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toBe("<img src=x>");
  });
});

describe("serializeEditor", () => {
  it("token 取 data-raw，文本节点原样，二者拼接", () => {
    const root = editor();
    root.appendChild(
      createReferenceTokenElement({
        kind: "skill",
        name: "apple-design",
        raw: "/skill:apple-design",
      }),
    );
    root.appendChild(document.createTextNode(" 帮我把间距统一一下"));
    expect(serializeEditor(root)).toBe(
      "/skill:apple-design 帮我把间距统一一下",
    );
  });

  it("BR 序列化成换行", () => {
    const root = editor();
    root.appendChild(document.createTextNode("a"));
    root.appendChild(document.createElement("br"));
    root.appendChild(document.createTextNode("b"));
    expect(serializeEditor(root)).toBe("a\nb");
  });

  it("null 与空编辑器都返回空串", () => {
    expect(serializeEditor(null)).toBe("");
    expect(serializeEditor(editor())).toBe("");
  });
});

describe("setEditorFromText + serializeEditor 往返", () => {
  it("行首技能：渲染成 token，序列化回原文", () => {
    const root = editor();
    setEditorFromText(root, "/skill:apple-design 改一下");
    expect(root.querySelector(`[${TOKEN_RAW_ATTR}]`)).not.toBeNull();
    expect(serializeEditor(root)).toBe("/skill:apple-design 改一下");
  });

  it("句中 /skill: 不渲染 token，原样是纯文本", () => {
    const root = editor();
    setEditorFromText(root, "帮我用 /skill:apple-design 改");
    expect(root.querySelector(`[${TOKEN_RAW_ATTR}]`)).toBeNull();
    expect(serializeEditor(root)).toBe("帮我用 /skill:apple-design 改");
  });

  it("行首命令渲染 token，序列化回原文", () => {
    const root = editor();
    setEditorFromText(root, "/compact 收一下");
    expect(root.querySelector(`[${TOKEN_RAW_ATTR}]`)).not.toBeNull();
    expect(serializeEditor(root)).toBe("/compact 收一下");
  });

  it("扩展命令需要 extraCommands 才认", () => {
    const root = editor();
    setEditorFromText(root, "/plan 做一遍", new Set(["plan"]));
    expect(serializeEditor(root)).toBe("/plan 做一遍");
    expect(root.querySelector(`[${TOKEN_RAW_ATTR}]`)).not.toBeNull();
  });

  it("空串清空编辑器", () => {
    const root = editor();
    setEditorFromText(root, "/skill:x 改");
    setEditorFromText(root, "");
    expect(root.childNodes).toHaveLength(0);
  });
});

describe("degradeNonLeadingTokens", () => {
  it("token 不再位于行首时退回纯文本", () => {
    const root = editor();
    setEditorFromText(root, "/skill:apple-design 改");
    root.insertBefore(document.createTextNode("注意 "), root.firstChild);
    degradeNonLeadingTokens(root);
    expect(root.querySelector(`[${TOKEN_RAW_ATTR}]`)).toBeNull();
    expect(serializeEditor(root)).toBe("注意 /skill:apple-design 改");
  });

  it("token 仍在行首时不动它", () => {
    const root = editor();
    setEditorFromText(root, "/skill:apple-design 改");
    degradeNonLeadingTokens(root);
    expect(root.querySelector(`[${TOKEN_RAW_ATTR}]`)).not.toBeNull();
  });
});

describe("getCaretOffset", () => {
  it("纯文本里返回字符偏移", () => {
    const root = editor();
    root.appendChild(document.createTextNode("abc"));
    const range = document.createRange();
    range.setStart(root.firstChild!, 2);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    expect(getCaretOffset(root)).toBe(2);
  });

  it("token 按 data-raw 的长度计入", () => {
    const root = editor();
    setEditorFromText(root, "/skill:alpha 改动");
    setCaretAtEnd(root);
    expect(getCaretOffset(root)).toBe("/skill:alpha 改动".length);
  });

  it("BR 在光标坐标里计 1（与 serializeEditor 同账）", () => {
    const root = editor();
    root.appendChild(document.createTextNode("a"));
    root.appendChild(document.createElement("br"));
    root.appendChild(document.createTextNode("b"));
    setCaretAtEnd(root);
    expect(getCaretOffset(root)).toBe("a\nb".length);
  });

  it("光标不在编辑器内时返回 0", () => {
    const root = editor();
    root.appendChild(document.createTextNode("abc"));
    window.getSelection()!.removeAllRanges();
    expect(getCaretOffset(root)).toBe(0);
  });
});

describe("escapeHtml", () => {
  it("四个字符都被转义", () => {
    expect(escapeHtml(`&<>"`)).toBe("&amp;&lt;&gt;&quot;");
  });
});
