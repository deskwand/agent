import { useTranslation } from "react-i18next";

import type { FeedItemWithMeta } from "../../shared/feed";

export interface FeedItemRowProps {
  item: FeedItemWithMeta;
  selected: boolean;
  onOpen: (id: string) => void;
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
  /** 首屏第一条常显次要操作，让用户知道它们存在（设计 §8.8）。 */
  showActionsAlways?: boolean;
}

/**
 * 一行 = 文本列（自适应）+ 图列（固定 88px）。
 * 无图时整列不渲染 —— 空框会被读成「加载失败」，而实际是我们主动放弃了那张图。
 * 排版数值见设计 §8.8；次要操作放在元信息行右端，**不用绝对定位**（会压住缩略图）。
 */
export function FeedItemRow({
  item,
  selected,
  onOpen,
  onRead,
  onDismiss,
  showActionsAlways = false,
}: FeedItemRowProps): JSX.Element {
  const { t } = useTranslation();
  const unread = item.read_at === null;

  return (
    <div
      className={`relative flex items-start gap-[11px] border-b border-border-subtle px-4 py-[10px] ${
        selected ? "bg-surface" : "hover:bg-surface-hover"
      }`}
    >
      {selected ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-0.5 bg-accent"
        />
      ) : null}

      <div className="min-w-0 flex-1">
        <button
          type="button"
          data-testid="feed-title"
          onClick={() => onOpen(item.id)}
          className={`flex w-full items-baseline gap-[7px] text-left text-[12.5px] leading-[1.5] ${
            unread
              ? "font-semibold text-text-primary"
              : "font-normal text-text-muted"
          }`}
        >
          {unread ? (
            <span
              data-testid="feed-unread-dot"
              aria-hidden
              className="relative -top-0.5 h-[5px] w-[5px] shrink-0 rounded-full bg-accent"
            />
          ) : null}
          <span className="min-w-0">{item.title}</span>
          {item.unprocessed === 1 ? (
            <span className="shrink-0 rounded-sm bg-surface-active px-1 text-[9px] text-text-muted">
              {t("feed.itemUnprocessed")}
            </span>
          ) : null}
        </button>

        {item.summary ? (
          <div
            data-testid="feed-summary"
            className="mt-[3px] text-[11.5px] text-text-muted"
            style={{
              lineHeight: 1.75,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {item.summary}
          </div>
        ) : null}

        <div className="mt-[6px] flex items-center gap-[7px] text-[10px] leading-[1.6] text-text-muted">
          {item.topic ? (
            <span className="rounded-sm bg-accent-muted px-1.5 py-px text-accent">
              {item.topic}
            </span>
          ) : null}
          <span className="opacity-45">·</span>
          <span>{item.source_host}</span>
          <span className="flex-1" />
          <span
            data-testid="feed-actions"
            className="flex gap-2.5 whitespace-nowrap"
            style={{
              opacity: showActionsAlways ? 1 : 0,
              transition: "opacity 120ms",
            }}
          >
            <button
              type="button"
              data-testid="feed-read"
              onClick={() => onRead(item.id)}
              className="underline decoration-text-muted/50"
            >
              {t("feed.itemRead")}
            </button>
            <button
              type="button"
              data-testid="feed-dismiss"
              onClick={() => onDismiss(item.id)}
              className="underline decoration-text-muted/50"
            >
              {t("feed.itemDismiss")}
            </button>
          </span>
        </div>
      </div>

      {item.imageUrl ? (
        <div className="mt-0.5 h-[58px] w-[88px] shrink-0 overflow-hidden rounded-[4px] bg-surface">
          <img
            src={item.imageUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      ) : null}
    </div>
  );
}
