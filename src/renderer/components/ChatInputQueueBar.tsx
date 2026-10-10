import { useTranslation } from "react-i18next";
import {
  MessageSquareDashed,
  Navigation,
  X,
  Image as ImageIcon,
  FileText,
} from "lucide-react";
import type { QueuedInput } from "../types";
import { Tooltip, TooltipContent, TooltipTrigger } from "./app-tooltip";
import { resolveLeadingToken } from "../utils/reference-tokens";
import { Button } from "./app-button";

interface ChatInputQueueBarProps {
  items: QueuedInput[];
  onSteer: (id: string) => void;
  onRemove: (id: string) => void;
  /** 会话运行中：带元素附件的条目不允许即时引导 */
  isRunning?: boolean;
}

/** 输入框上方排队区：非 idle 发送的消息按时序一行一条，行末引导/删除。
 *  附件仅显示图标标记 + 文件名（空间有限）。 */
export function ChatInputQueueBar({
  items,
  onSteer,
  onRemove,
  isRunning = false,
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
            {(item.elSelections ?? []).map((selection) => (
              <span
                key={`${selection.pageUrl}|${selection.selector}`}
                title={selection.selector}
                className="max-w-[8rem] truncate rounded bg-background/60 px-1.5 py-0.5 text-text-muted"
              >
                {selection.tag}
                {selection.classes[0] ? `.${selection.classes[0]}` : ""}
              </span>
            ))}
          </span>
          {/* 老 Tooltip 的语义：label 为空 =「此刻没有提示」，不渲染气泡。
              迁到 Radix 后用**条件渲染 TooltipContent** 保持同一语义（Root/Trigger
              常驻，但没有 Content 就不会有气泡）。老组件的空 label 用例在
              tests/renderer/tooltip.test.ts，这条调用形态与它同源。 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost"
                type="button"
                disabled={isRunning && Boolean(item.elSelections?.length)}
                className="flex flex-shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] bg-primary/15 text-primary hover:bg-primary/25 transition-[background-color] active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed h-auto"
                onClick={() => onSteer(item.id)}
              >
                <Navigation className="h-3 w-3" />
                {t("steer.label")}
              </Button>
            </TooltipTrigger>
            {isRunning && item.elSelections?.length ? (
              <TooltipContent side="bottom">
                {t("browser.picker.waitForNextTurn")}
              </TooltipContent>
            ) : null}
          </Tooltip>
          <Button variant="ghost"
            type="button"
            aria-label={t("steer.remove")}
            className="flex-shrink-0 rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text-primary transition-colors h-auto"
            onClick={() => onRemove(item.id)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </li>
      ))}
    </ul>
  );
}
