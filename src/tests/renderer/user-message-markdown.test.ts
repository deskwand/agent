// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import { remarkUserLines } from "../../renderer/components/MessageMarkdown";
import { UserTextWithTokens } from "../../renderer/components/message/UserTextWithTokens";
import { ContentBlockView } from "../../renderer/components/message/ContentBlockView";
import { useAppStore } from "../../renderer/store";

type Node = { type: string; value?: string; children?: Node[] };

function run(tree: Node): Node {
  (remarkUserLines() as unknown as (t: Node) => void)(tree);
  return tree;
}

describe("remarkUserLines", () => {
  it("段落里的单个换行变成 break 节点", () => {
    const tree = run({
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "甲\n乙\n丙" }],
        },
      ],
    });
    const paragraph = tree.children![0];
    expect(paragraph.children!.map((n) => n.type)).toEqual([
      "text",
      "break",
      "text",
      "break",
      "text",
    ]);
  });

  it("代码块不被动（没有 children，行尾空白有意义）", () => {
    const tree = run({
      type: "root",
      children: [{ type: "code", value: "a\nb" }],
    });
    expect(tree.children![0]).toEqual({ type: "code", value: "a\nb" });
  });

  it("列表项内的换行同样生效，且不改结构", () => {
    const tree = run({
      type: "root",
      children: [
        {
          type: "list",
          children: [
            {
              type: "listItem",
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", value: "a\nb" }],
                },
              ],
            },
          ],
        },
      ],
    });
    const item = tree.children![0].children![0];
    expect(item.children![0].children!.map((n) => n.type)).toEqual([
      "text",
      "break",
      "text",
    ]);
  });

  const paragraph = (value: string): Node => ({
    type: "root",
    children: [{ type: "paragraph", children: [{ type: "text", value }] }],
  });
  const kinds = (value: string) =>
    run(paragraph(value)).children![0].children!.map((n) => n.type);

  it("口述枚举（句号分隔）补行首换行", () => {
    expect(kinds("我的要求有几个：1. 甲。2. 乙。")).toEqual([
      "text",
      "break",
      "text",
      "break",
      "text",
    ]);
  });

  it("口述枚举（逗号分隔，听写最常见）同样切", () => {
    expect(kinds("我的要求有几个，1. 甲，2. 乙，3. 丙。")).toEqual([
      "text",
      "break",
      "text",
      "break",
      "text",
      "break",
      "text",
    ]);
  });

  it("不从 1 开始、不连续的数字不动", () => {
    expect(kinds("第 1、2、3 点")).toEqual(["text"]);
    expect(kinds("见 9. 七 和 10. 八")).toEqual(["text"]);
    expect(kinds("把间距放大 1.5 倍")).toEqual(["text"]);
  });

  it("文本节点开头（chip 后面紧跟 1.）不切", () => {
    expect(kinds(" 1. 甲 2. 乙")).toEqual(["text"]);
  });

  it("行内 code 与围栏代码块不受影响（换行只进 text 节点）", () => {
    const tree = run({
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "inlineCode", value: "a 1. x 2. y" },
            { type: "text", value: "，1. 甲，2. 乙。" },
          ],
        },
        { type: "code", value: "const a = 1. x 2. y;" },
      ],
    });
    expect(tree.children![0].children!.map((n) => n.type)).toEqual([
      "inlineCode",
      "text",
      "break",
      "text",
      "break",
      "text",
    ]);
    expect(tree.children![1]).toEqual({
      type: "code",
      value: "const a = 1. x 2. y;",
    });
  });
});

let container: HTMLDivElement;
let root: Root;
const clickedFiles: string[] = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.setItem("i18nextLng", "en");
  useAppStore.getState().setCommandLabels(new Map([["plan", "/plan"]]));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clickedFiles.length = 0;
  useAppStore.getState().setCommandLabels(new Map());
  vi.restoreAllMocks();
});

async function renderUserText(text: string) {
  await act(async () => {
    root.render(
      React.createElement(UserTextWithTokens, {
        text,
        resolveFilePath: (v: string) => `/cwd/${v}`,
        onFileClick: (v: string) => clickedFiles.push(v),
      }),
    );
  });
  // MessageMarkdown 是 lazy()：等它落地（首帧是纯文本兜底）
  for (let i = 0; i < 5 && !container.querySelector(".prose-chat"); i += 1) {
    await act(async () => {});
  }
}

describe("用户气泡 markdown", () => {
  it("粗体被解析", async () => {
    await renderUserText("**粗体**");
    expect(container.querySelector("strong")?.textContent).toBe("粗体");
  });

  it("听写那一整段带编号的文本按项分行", async () => {
    await renderUserText("我的要求有几个：1. 甲。2. 乙。3. 丙。");
    expect(container.querySelectorAll("br").length).toBe(3);
    expect(container.textContent).toContain("3. 丙。");
  });

  it("围栏代码块里的数字不被当成枚举", async () => {
    await renderUserText("```js\nconst a = 1. x 2. y;\n```");
    expect(container.querySelector("pre")).not.toBeNull();
    expect(container.querySelector("pre br")).toBeNull();
  });

  it("本来就分行的编号列表也正常", async () => {
    await renderUserText("1. 甲\n2. 乙");
    expect(container.querySelectorAll("ol > li").length).toBe(2);
  });

  it("单个换行仍是换行，不拼回一段", async () => {
    await renderUserText("甲\n乙");
    expect(container.querySelectorAll("br").length).toBe(1);
  });

  it("行首技能渲染成 chip，不出现字面 /skill:", async () => {
    await renderUserText("/skill:brainstorming 你看看");
    expect(container.textContent).toContain("brainstorming");
    expect(container.textContent).not.toContain("/skill:");
  });

  it("行首命令 chip 保留斜杠", async () => {
    await renderUserText("/plan 排一下");
    expect(container.textContent).toContain("/plan");
  });

  it("文件提及仍渲染成可点击 token，下划线还在", async () => {
    await renderUserText("看下 src/a.ts");
    const button = container.querySelector("button");
    expect(button?.textContent).toContain("src/a.ts");
    expect(button?.querySelector("[class*='underline']")).not.toBeNull();
  });

  it("路径出现在标题里也可点（覆盖 MENTION_TAGS）", async () => {
    await renderUserText("# 看下 src/a.ts");
    expect(container.querySelector("h1 button")).not.toBeNull();
  });

  it("相对链接保留 href，不变成死链", async () => {
    await renderUserText("[方案](./docs/a.md)");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "./docs/a.md",
    );
  });

  it("raw HTML 不执行：script 标签被摘掉，正文留下", async () => {
    await renderUserText("前 <script>alert(1)</script> 正常文本");
    expect(container.querySelector("script")).toBeNull();
    expect(container.innerHTML).not.toContain("<script");
    expect(container.textContent).toContain("正常文本");
  });

  it("javascript: 链接的 href 被抹掉", async () => {
    await renderUserText("[点我](javascript:alert(1))");
    expect(container.querySelector("a")?.getAttribute("href")).toBeNull();
  });

  it("远程图片不发请求：渲染成带 title 的文字", async () => {
    await renderUserText("![截图](https://example.com/a.png)");
    expect(container.querySelector("img")).toBeNull();
    expect(
      container.querySelector("span[title='https://example.com/a.png']"),
    ).not.toBeNull();
  });

  it(".message-user-text 里包含 .prose-chat（划词白名单依赖它）", async () => {
    await renderUserText("今天天气不错");
    expect(
      container.querySelector(".message-user-text > .prose-chat"),
    ).not.toBeNull();
  });

  it("http 链接走 openExternal，本地相对路径走 onFileClick", async () => {
    const openExternal = vi.fn(() => Promise.resolve(true));
    const sandbox = window as unknown as { electronAPI?: unknown };
    const previous = sandbox.electronAPI;
    sandbox.electronAPI = { openExternal };
    try {
      await renderUserText("[官网](https://example.com/a) [方案](docs/a.md)");
      const links = Array.from(container.querySelectorAll("a"));
      expect(links.length).toBe(2);
      expect(links[1]!.getAttribute("href")).toBe("docs/a.md");
      act(() => links[0]!.click());
      expect(openExternal).toHaveBeenCalledWith("https://example.com/a");
      act(() => links[1]!.click());
      expect(clickedFiles).toEqual(["docs/a.md"]);
    } finally {
      sandbox.electronAPI = previous;
    }
  });

  it("解不出的哨兵载荷不会把私用区字符吐给用户", async () => {
    await renderUserText("`\uE000junk`");
    expect(container.textContent ?? "").not.toContain("\uE000");
  });
});

describe("用户气泡（ContentBlockView 集成）", () => {
  it("isUser 文本块走 markdown，且外层不再有 whitespace-pre-wrap", async () => {
    await act(async () => {
      root.render(
        React.createElement(ContentBlockView, {
          block: { type: "text", text: "**粗体**\n\n1. 甲\n2. 乙" },
          isUser: true,
        }),
      );
    });
    await act(async () => {});
    const wrapper = container.querySelector(".message-user-text");
    expect(wrapper).not.toBeNull();
    expect(wrapper!.querySelector("strong")?.textContent).toBe("粗体");
    expect(wrapper!.querySelectorAll("ol > li").length).toBe(2);
    expect(wrapper!.className).not.toContain("whitespace-pre-wrap");
  });
});
