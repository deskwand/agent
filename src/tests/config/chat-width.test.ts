import { describe, expect, it } from "vitest";
import {
  CHAT_WIDTH_MAX_CLASS,
  DEFAULT_CHAT_WIDTH,
  VALID_CHAT_WIDTHS,
  chatColumnMaxWidth,
  isChatWidth,
  normalizeChatWidth,
} from "../../shared/chat-width";

describe("chatWidth 的三档定义", () => {
  it("默认是标准档", () => {
    expect(DEFAULT_CHAT_WIDTH).toBe("standard");
    expect(VALID_CHAT_WIDTHS).toEqual(["narrow", "standard", "wide"]);
  });

  it("只认这三档（空串、未知值、非字符串都不算）", () => {
    for (const w of VALID_CHAT_WIDTHS) expect(isChatWidth(w)).toBe(true);
    // Radix ToggleGroup 再点当前档会回传空串 —— 必须被挡掉
    expect(isChatWidth("")).toBe(false);
    expect(isChatWidth("huge")).toBe(false);
    expect(isChatWidth(undefined)).toBe(false);
    expect(isChatWidth(null)).toBe(false);
    expect(isChatWidth(2)).toBe(false);
    expect(isChatWidth({ width: "wide" })).toBe(false);
  });

  it("脏值归一成标准档，合法值原样返回", () => {
    expect(normalizeChatWidth("wide")).toBe("wide");
    expect(normalizeChatWidth("narrow")).toBe("narrow");
    expect(normalizeChatWidth("huge")).toBe("standard");
    expect(normalizeChatWidth(undefined)).toBe("standard");
    expect(normalizeChatWidth(null)).toBe("standard");
    expect(normalizeChatWidth("")).toBe("standard");
  });
});

describe("chatWidth 的宽度类名", () => {
  it("三档都是 rem 的 max-w 任意值（跟随 --ui-font-scale，不跟 px）", () => {
    for (const w of VALID_CHAT_WIDTHS) {
      expect(CHAT_WIDTH_MAX_CLASS[w]).toMatch(/^max-w-\[\d+(\.\d+)?rem\]$/);
    }
  });

  it("窄 < 标准 < 宽，且宽档就是改造前的 57.5rem", () => {
    expect(CHAT_WIDTH_MAX_CLASS.narrow).toBe("max-w-[40rem]");
    expect(CHAT_WIDTH_MAX_CLASS.standard).toBe("max-w-[48rem]");
    expect(CHAT_WIDTH_MAX_CLASS.wide).toBe("max-w-[57.5rem]");
  });

  it("拿不到设置时也给标准档，绝不返回 undefined/空串", () => {
    // 否则模板里拼出 `undefined` 类名，列宽约束静默失效、消息铺满整屏
    expect(chatColumnMaxWidth(undefined)).toBe("max-w-[48rem]");
    expect(chatColumnMaxWidth("")).toBe("max-w-[48rem]");
    expect(chatColumnMaxWidth("wide")).toBe("max-w-[57.5rem]");
  });
});
