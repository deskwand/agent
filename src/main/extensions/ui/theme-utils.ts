import { Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";

// 无色 Theme（P0 无 TUI 渲染，仅提供 API 表面）：
// fgAnsi("") 返回无色 reset，扩展调用 theme.fg(...) 时原样返回文本。
const THEME_COLOR_KEYS: ThemeColor[] = [
  "accent", "border", "borderAccent", "borderMuted", "success", "error",
  "warning", "muted", "dim", "text", "thinkingText", "userMessageText",
  "customMessageText", "customMessageLabel", "toolTitle", "toolOutput",
  "mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock",
  "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet",
  "toolDiffAdded", "toolDiffRemoved", "toolDiffContext", "syntaxComment",
  "syntaxKeyword", "syntaxFunction", "syntaxVariable", "syntaxString",
  "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation",
  "thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium",
  "thinkingHigh", "thinkingXhigh", "thinkingMax", "bashMode",
];
const THEME_BG_KEYS = [
  "selectedBg", "userMessageBg", "customMessageBg", "toolPendingBg",
  "toolSuccessBg", "toolErrorBg",
] as const;
type BgKey = (typeof THEME_BG_KEYS)[number];

let cachedTheme: Theme | undefined;

export function createNoopTheme(): Theme {
  if (!cachedTheme) {
    const fgColors = Object.fromEntries(
      THEME_COLOR_KEYS.map((c) => [c, ""]),
    ) as Record<ThemeColor, string>;
    const bgColors = Object.fromEntries(
      THEME_BG_KEYS.map((c) => [c, ""]),
    ) as Record<BgKey, string>;
    cachedTheme = new Theme(fgColors, bgColors, "256color");
  }
  return cachedTheme;
}
