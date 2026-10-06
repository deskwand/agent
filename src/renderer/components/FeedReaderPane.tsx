import { useTranslation } from "react-i18next";

import type { FeedBodyPayload, FeedItemWithMeta } from "../../shared/feed";

export interface FeedReaderPaneProps {
  item: FeedItemWithMeta;
  body: FeedBodyPayload | null;
  onOpenInBrowser: (url: string) => void;
}

/**
 * 右栏：顶部大图 → 标题 → 元信息 → 摘要块 → 相关性 → 正文摘录。
 * 正文限宽 34em（≈40 个中文字符），这是 WCAG 1.4.8 对 CJK 的上限（设计 §8.8）。
 * 字号用应用 token：标题 text-lg、正文 text-base（与聊天正文同档）、其余 text-xs；
 * 大图高度也写 rem（6.5rem = 104px），否则字号调大后限宽 34em 变宽而高度不变，图就被拉成横条。
 * 正文用 text-primary 而不是 muted：浅色主题下 muted 在 background-secondary 上只有 4.06:1，
 * 低于 WCAG AA 对正文的 4.5:1，而这是右栏里唯一要真读的一段字。
 * 文案必须是「摘录」：库里的 body 是截到 3000 字符的稿子，写成「原文」是骗人。
 */

/** 无选中条目时的占位（设计 §8.3：两栏常驻，右栏不为空）。 */
export function FeedReaderPlaceholder(): JSX.Element {
  const { t } = useTranslation();

  return (
    <div
      data-testid="feed-reader-empty"
      className="flex h-full items-center justify-center px-6 text-center text-sm text-text-muted"
      style={{ lineHeight: 1.8 }}
    >
      {t("feed.readerEmpty")}
    </div>
  );
}

export function FeedReaderPane({
  item,
  body,
  onOpenInBrowser,
}: FeedReaderPaneProps): JSX.Element {
  const { t } = useTranslation();
  const text = body?.body ?? null;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background-secondary px-5 py-3.5">
      {item.imageUrl ? (
        <div
          data-testid="feed-hero"
          className="mb-3 h-[6.5rem] w-full overflow-hidden rounded-md bg-surface"
          style={{ maxWidth: "34em" }}
        >
          <img
            src={item.imageUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}

      <h2
        className="mb-1.5 text-lg font-semibold leading-[1.4]"
        style={{ maxWidth: "30em" }}
      >
        {item.title}
      </h2>

      <div className="mb-3 text-xs leading-[1.75] text-text-muted">
        <span>{item.source_host}</span>
        <span className="px-1.5 opacity-45">·</span>
        <span className="tabular-nums">
          {new Date(item.created_at).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <span className="px-1.5 opacity-45">·</span>
        <span>{t("feed.readerExcerpt")}</span>
      </div>

      {item.summary ? (
        <div
          className="mb-3 border-l-2 border-accent pl-3 text-sm text-text-primary"
          style={{ maxWidth: "34em", lineHeight: 1.8 }}
        >
          {item.summary}
        </div>
      ) : null}

      {item.relevance ? (
        <div
          className="mb-3 text-xs text-accent"
          style={{ maxWidth: "34em", lineHeight: 1.75 }}
        >
          {item.relevance}
        </div>
      ) : null}

      {body?.bodyStatus === "snippet_only" ? (
        <div className="mb-3 text-xs text-text-muted">
          {t("feed.readerSnippetOnly")}
        </div>
      ) : null}

      {text ? (
        <div
          data-testid="feed-body"
          className="text-base text-text-primary"
          style={{ maxWidth: "34em", lineHeight: 1.8 }}
        >
          {text.split(/\n{2,}/).map((paragraph, index) => (
            <p key={index} style={{ margin: "0 0 1.8em" }}>
              {paragraph}
            </p>
          ))}
        </div>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2.5 border-t border-border-subtle pt-2 text-xs leading-[1.75] text-text-muted">
        <span>{t("feed.readerExcerpt")}</span>
        <button
          type="button"
          data-testid="feed-open-browser"
          onClick={() => onOpenInBrowser(item.url)}
          className="whitespace-nowrap text-accent"
        >
          {t("feed.readerOpenInBrowser")} ↗
        </button>
      </div>
    </div>
  );
}
