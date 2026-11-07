/**
 * 消息区列宽的三档。
 *
 * 主进程（配置校验/落盘）与渲染层（设置面板/列宽类名）共用这一份，
 * 放在 shared 是为了「三档」只有一处定义 —— 两边各写一个联合类型，
 * 迟早出现「面板能选、配置不认」。
 *
 * 取值依据：阅读测量 65–75 字符/行（Bringhurst；WCAG 1.4.8 上限 80）。
 * ChatGPT 与 Claude 的正文列都是 768px，本仓正文是 14px（比它们小一号），
 * 同样像素宽度下每行字符更多，所以 920px（原值）当「宽」档、不当下限。
 */
/** 运行时校验数组 —— 同时就是 `ChatWidth` 联合的真源（联合从它派生，不会两边漂）。 */
export const VALID_CHAT_WIDTHS = ["narrow", "standard", "wide"] as const;

export type ChatWidth = (typeof VALID_CHAT_WIDTHS)[number];

export const DEFAULT_CHAT_WIDTH: ChatWidth = "standard";

export function isChatWidth(value: unknown): value is ChatWidth {
  return (
    typeof value === "string" &&
    (VALID_CHAT_WIDTHS as readonly string[]).includes(value)
  );
}

/** 读旧配置 / 手改坏的配置用：认不出就落默认，不抛错。 */
export function normalizeChatWidth(value: unknown): ChatWidth {
  return isChatWidth(value) ? value : DEFAULT_CHAT_WIDTH;
}

/**
 * 列宽类名。必须用 rem：`html { font-size: calc(16px * var(--ui-font-scale)) }`，
 * 列宽随 UI 字号一起缩放，字号调到 20px 时行内字符数不变（换成 px 就会塌成一行挤爆）。
 *
 * ⚠️ 这些字符串要能被 Tailwind 扫到（tailwind.config 的 content 覆盖了 src 下的
 * ts/tsx），所以写成字面量，不要用模板字符串拼类名 —— 拼出来的扫不到，样式会静默丢失。
 */
export const CHAT_WIDTH_MAX_CLASS: Readonly<Record<ChatWidth, string>> = {
  narrow: "max-w-[40rem]",
  standard: "max-w-[48rem]",
  wide: "max-w-[57.5rem]",
};

/** 设置值 → 类名。undefined / 脏值一律回标准档。 */
export function chatColumnMaxWidth(width: unknown): string {
  return CHAT_WIDTH_MAX_CLASS[normalizeChatWidth(width)];
}
