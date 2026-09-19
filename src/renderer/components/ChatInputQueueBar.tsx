import { useTranslation } from "react-i18next";
import {
  MessageSquareDashed,
  Navigation,
  X,
  Image as ImageIcon,
  FileText,
} from "lucide-react";
import type { QueuedInput } from "../types";
import { resolveLeadingToken } from "../utils/reference-tokens";

interface ChatInputQueueBarProps {
  items: QueuedInput[];
  onSteer: (id: string) => void;
  onRemove: (id: string) => void;
}

/** 输入框上方排队区：非 idle 发送的消息按时序一行一条，行末引导/删除。
 *  附件仅显示图标标记 + 文件名（空间有限）。 */
export function ChatInputQueueBar({
  items,
  onSteer,
  onRemove,
}: ChatInputQueueBarProps) {
  const { t } = useTranslation();
  if (items.length === 0) return null;

  /**
   * 行首引用的显示文本 —— 与「发出的气泡」同一条规则：
   * 技能的 `/skill:` 是纯写入噪音，显示时去掉（`/skill:alpha 帮我…` → `alpha 帮我…`）；
   * 命令的斜杠有语义，保留（`/plan 做一遍` 原样），所以那种情况整串与入参一致。
   * 规则出处见 components/ReferenceToken.tsx 的 kind 说明，两侧分别由
   * tests/renderer/{chat-input-queue-bar,user-message-tokens}.test.ts 锁着。
   *
   * 只改显示。item.text 本身必须原样保留：sendQueuedItem（ChatView.tsx）把它当 text block
   * 发给 SDK，而 pi 只在消息**以 `/skill:` 开头**时才展开技能（见 reference-tokens.ts）。
   * 完整原文仍通过 title 悬停可见。
   */
  const displayText = (text: string): string => {
    const token = resolveLeadingToken(text);
    if (token?.kind !== "skill") return text;
    return `${token.name}${text.slice(token.raw.length)}`;
  };
  return (
    <ul className="space-y-1 px-1 pb-1">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex items-center gap-2 rounded-lg bg-surface-hover/60 px-2.5 py-1.5 text-xs"
        >
          <MessageSquareDashed className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
          <span
            className="min-w-0 flex-1 truncate text-text-primary"
            title={item.text}
          >
            {displayText(item.text)}
          </span>
          <span className="flex flex-shrink-0 items-center gap-1 overflow-hidden">
            {(item.images ?? []).map((_, index) => (
              <span
                key={`img-${index}`}
                title={t("steer.imageAttachment")}
                className="flex items-center gap-1 rounded bg-background/60 px-1.5 py-0.5 text-text-muted"
              >
                <ImageIcon className="h-3 w-3" />
                <span className="max-w-[5rem] truncate">
                  {t("steer.imageAttachment")}
                </span>
              </span>
            ))}
            {(item.files ?? []).map((file, index) => (
              <span
                key={`file-${index}`}
                title={file.filename}
                className="flex items-center gap-1 rounded bg-background/60 px-1.5 py-0.5 text-text-muted"
              >
                <FileText className="h-3 w-3" />
                <span className="max-w-[5rem] truncate">{file.filename}</span>
              </span>
            ))}
          </span>
          <button
            type="button"
            className="flex flex-shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] bg-accent/15 text-accent hover:bg-accent/25 transition-[background-color] active:scale-[0.97]"
            onClick={() => onSteer(item.id)}
          >
            <Navigation className="h-3 w-3" />
            {t("steer.label")}
          </button>
          <button
            type="button"
            aria-label={t("steer.remove")}
            className="flex-shrink-0 rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text-primary transition-colors"
            onClick={() => onRemove(item.id)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}
