// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SELECTION_ALLOW,
  SELECTION_SUPPRESS,
  resolveSelectionContext,
  type SelectionLike,
} from "../../renderer/utils/selection-menu";

const ZERO = {
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
  width: 0,
  height: 0,
} as DOMRect;
const rectOf = () => ZERO;

/** 把一个真实 DOM 节点做成选区形状的假对象：jsdom 的 Selection 只实现了子集。 */
function fakeSelection(anchor: Node, text: string): SelectionLike {
  const range = document.createRange();
  range.selectNodeContents(anchor);
  return {
    isCollapsed: text.length === 0,
    rangeCount: 1,
    anchorNode: anchor,
    toString: () => text,
    getRangeAt: () => range,
  };
}

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("resolveSelectionContext", () => {
  it("折叠选区不算", () => {
    const el = mount(`<div class="prose-chat">正文</div>`);
    expect(
      resolveSelectionContext(fakeSelection(el, ""), { rectOf }),
    ).toBeNull();
  });

  it("只有空白不算", () => {
    const el = mount(`<div class="prose-chat">正文</div>`);
    expect(
      resolveSelectionContext(fakeSelection(el, "   \n  "), { rectOf }),
    ).toBeNull();
  });

  it("不在 allowlist 面内不算（禁选骨架）", () => {
    const el = mount(`<div class="sidebar-chrome">骨架</div>`);
    expect(
      resolveSelectionContext(fakeSelection(el, "骨架"), { rectOf }),
    ).toBeNull();
  });

  it("输入控件内不算（编辑器已有 slash 菜单）", () => {
    const el = mount(`<textarea>草稿</textarea>`);
    expect(
      resolveSelectionContext(fakeSelection(el, "草稿"), { rectOf }),
    ).toBeNull();
  });

  it("内容面内算，且原样文本与折叠文本分开", () => {
    const el = mount(`<pre class="selectable">  if (a) {\n    b();\n  }</pre>`);
    const ctx = resolveSelectionContext(
      fakeSelection(el, "  if (a) {\n    b();\n  }"),
      { rectOf },
    );
    expect(ctx?.rawText).toBe("  if (a) {\n    b();\n  }"); // 复制用：缩进与换行都在
    expect(ctx?.text).toBe("if (a) { b(); }"); // 朗读用：折叠空白
    expect(ctx?.inDialog).toBe(false);
  });

  it("跨块选区按锚点判定，不要求首尾同面", () => {
    const el = mount(`<div class="prose-chat"><p>段落</p></div>`);
    // 用文本节点做锚点：解析要走 parentElement
    const ctx = resolveSelectionContext(
      fakeSelection(el.querySelector("p")!.firstChild!, "段落"),
      { rectOf },
    );
    expect(ctx).not.toBeNull();
  });

  it("弹层内标记 inDialog（Radix Popover 的 role=dialog 也算）", () => {
    const el = mount(
      `<div role="dialog"><p class="selectable">配置串</p></div>`,
    );
    const ctx = resolveSelectionContext(fakeSelection(el, "配置串"), {
      rectOf,
    });
    expect(ctx?.inDialog).toBe(true);
  });

  it("矩形由 rectOf 提供，且 range 是快照（clone）不是活的对象", () => {
    const el = mount(`<div class="selectable">文字</div>`);
    const spy = vi.fn(() => ({ ...ZERO, top: 42 }) as DOMRect);
    const live = fakeSelection(el, "文字");
    const ctx = resolveSelectionContext(live, { rectOf: spy });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(ctx?.rect.top).toBe(42);
    expect(ctx?.range).not.toBe(live.getRangeAt(0));
  });

  it("两份名单相加等于 CSS 的 allowlist", () => {
    const entries = (value: string) => value.split(",").map((s) => s.trim());
    expect(
      [...entries(SELECTION_ALLOW), ...entries(SELECTION_SUPPRESS)].sort(),
    ).toEqual(
      [
        "input",
        "textarea",
        "[contenteditable]",
        "pre",
        "code",
        '[role="dialog"]',
        '[role="alertdialog"]',
        ".prose-chat",
        ".message-user-text",
        ".selectable",
      ].sort(),
    );
  });

  it("菜单标签使用短文案，同时保留朗读中的明确停止动作", async () => {
    const zh = (await import("../../renderer/i18n/locales/zh.json")).default;
    const en = (await import("../../renderer/i18n/locales/en.json")).default;

    expect(zh.selectionMenu).toMatchObject({
      readAloud: "朗读",
      stopReading: "停止朗读",
      saveIdea: "记一笔",
      quote: "引用",
      copy: "复制",
    });
    expect(en.selectionMenu).toMatchObject({
      readAloud: "Read",
      stopReading: "Stop reading",
      saveIdea: "Save idea",
      quote: "Quote",
      copy: "Copy",
    });
  });

  it("注册表里每个文案 key 在 zh 与 en 都存在", async () => {
    // renderer-i18n-keys.test.ts 用正则抓 t("…") 字面量，动态 key 是它文件头
    // 写明的盲区 —— 这张注册表可以穷举，所以在这里兜。
    const { SELECTION_ACTIONS } =
      await import("../../renderer/components/selection-menu-actions");
    const zh = (await import("../../renderer/i18n/locales/zh.json")).default;
    const en = (await import("../../renderer/i18n/locales/en.json")).default;
    const leafKeys = (value: unknown, prefix = ""): string[] => {
      if (value === null || typeof value !== "object") return [prefix];
      return Object.entries(value as Record<string, unknown>).flatMap(
        ([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key),
      );
    };
    const zhKeys = new Set(leafKeys(zh));
    const enKeys = new Set(leafKeys(en));
    for (const action of SELECTION_ACTIONS) {
      expect(zhKeys.has(action.labelKey), `zh 缺少 ${action.labelKey}`).toBe(
        true,
      );
      expect(enKeys.has(action.labelKey), `en 缺少 ${action.labelKey}`).toBe(
        true,
      );
    }
  });
});
