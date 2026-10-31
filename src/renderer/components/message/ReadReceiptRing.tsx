import { useTranslation } from "react-i18next";
import type { ReadReceiptState } from "../../utils/message-read";

/**
 * 气泡右侧的已读回执环（飞书那套）：未读 = 灰色空心环，已读 = 对号环。
 * 15px，挂在 22px（16 + gap 6）的窄槽里，不占正文宽度；也不参与元数据那排
 * （那排仍是悬停才淡入）。
 *
 * 颜色全走主题变量（`--foreground` / `--muted-foreground`），不用 `--success`：
 * 后者是「固定语义层」，不随 palette 变，所有主题共用一个绿 —— 在单色聊天区里一个
 * 绿勾会很跳。已读/未读的差别交给形状（实勾 vs 空心环）和深浅（foreground/70 vs
 * muted-foreground/75），颜色跟着主题走。
 *
 * ⚠️ 这是**状态**不是按钮：没有 onClick，读屏靠 role="img" + aria-label。
 * 「点开看谁读了」是 IM 的事 —— 这里只有一个「读者」，点开也没内容。
 */
export function ReadReceiptRing({ state }: { state: ReadReceiptState }) {
  const { t } = useTranslation();
  const read = state === "read";
  const label = t(read ? "messageCard.read" : "messageCard.unread");
  return (
    <span
      // mb-[3px]：行是 items-end，气泡底边对齐后环还差半行 —— 抬 3px 让它跟最后一行
      // 文字的重心齐平，不是随便取的值。
      className={`mb-[3px] flex h-4 w-4 flex-none items-center justify-center ${
        read ? "text-foreground/70" : "text-muted-foreground/75"
      }`}
      role="img"
      aria-label={label}
    >
      <svg
        viewBox="0 0 16 16"
        className="h-[15px] w-[15px]"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="6.2" />
        {read ? <path d="m5.2 8.1 1.9 1.9 3.7-3.9" /> : null}
      </svg>
    </span>
  );
}
