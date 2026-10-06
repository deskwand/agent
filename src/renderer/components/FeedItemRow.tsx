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
 * 排版见设计 §8.8：字号只准用应用 token（text-xs/sm/base），
 * 写死 px 不跟随「设置 → 字号」（App.tsx 把字号实现为根字号上的 --ui-font-scale，只有 rem 会缩放）。
 * 次要操作放在元信息行右端，**不用绝对定位**（会压住缩略图）。
 * 整行可点：行容器自己接 onClick（设计 §8.3「点条目」），
 * 所以行里每个可交互元素（标题、已读、不感兴趣）都必须 stopPropagation，否则会顺带打开右栏。
 * 但拖拽选中文本时浏览器也会派发 click，所以打开前必须先过 `isSelectingText()`：
 * 打开 = 标记已读，而这里没有「标记未读」的反向操作 —— 复制摘要不能把未读状态吃掉。
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
      data-testid="feed-row"
      onClick={() => {
        if (isSelectingText()) return;
        onOpen(item.id);
      }}
      className={`relative flex cursor-pointer items-start gap-3 border-b border-border-subtle px-4 py-2.5 ${
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
          onClick={(event) => {
            event.stopPropagation();
            if (isSelectingText()) return;
            onOpen(item.id);
          }}
          className={`flex w-full items-baseline gap-2 text-left text-base leading-[1.4] ${
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
          {unread ? (
            <span className="sr-only">{t("feed.itemUnread")}</span>
          ) : null}
          <span className="min-w-0">{item.title}</span>
          {item.unprocessed === 1 ? (
            <span className="shrink-0 rounded-sm bg-surface-active px-1 text-xs text-text-muted">
              {t("feed.itemUnprocessed")}
            </span>
          ) : null}
        </button>

        {item.summary ? (
          <div
            data-testid="feed-summary"
            className="mt-1 text-sm text-text-muted"
            style={{
              lineHeight: 1.8,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {item.summary}
          </div>
        ) : null}

        <div
          data-testid="feed-meta"
          className="mt-1.5 flex items-center gap-2 text-xs leading-[1.75] text-text-muted"
        >
          {item.topic ? (
            // 两栏常驻后列表只有一半宽，长主题会折行 —— 标签必须不换行（宁可挤掉来源域名）
            <span className="shrink-0 whitespace-nowrap rounded-sm bg-accent-muted px-1.5 py-px text-accent">
              {item.topic}
            </span>
          ) : null}
          <span className="opacity-45">·</span>
          <span className="min-w-0 truncate">{item.source_host}</span>
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
              onClick={(event) => {
                event.stopPropagation();
                onRead(item.id);
              }}
              className="underline decoration-text-muted/50"
            >
              {t("feed.itemRead")}
            </button>
            <button
              type="button"
              data-testid="feed-dismiss"
              onClick={(event) => {
                event.stopPropagation();
                onDismiss(item.id);
              }}
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

/**
 * 当前是否有被选中的文字。
 *
 * 浏览器在「按下与抬起落在同一元素」时会派发 click，所以拖拽选中摘要/标题再松手
 * 也会走 open——那会把条目标成已读，而动态没有「标记未读」的反向操作。
 * 用手势语义拒绝这种情况，注释见文件头。
 */
function isSelectingText(): boolean {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed);
}
