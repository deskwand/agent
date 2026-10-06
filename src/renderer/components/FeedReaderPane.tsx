import { useTranslation } from "react-i18next";

import type { FeedItemWithMeta } from "../../shared/feed";

export interface FeedReaderPaneProps {
  item: FeedItemWithMeta;
  body: { body: string | null; bodyStatus: string } | null;
  onOpenInBrowser: (url: string) => void;
}

/**
 * 右栏：顶部大图 → 标题 → 元信息 → 摘要块 → 相关性 → 正文摘录。
 * 正文限宽 34em（≈40 个中文字符），这是 WCAG 1.4.8 对 CJK 的上限（设计 §8.8）。
 * 文案必须是「摘录」：库里的 body 是截到 3000 字符的稿子，写成「原文」是骗人。
 */
export function FeedReaderPane({
  item,
  body,
  onOpenInBrowser,
}: FeedReaderPaneProps): JSX.Element {
  const { t } = useTranslation();
  const text = body?.body ?? null;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background-secondary px-[18px] py-[14px]">
      {item.imageUrl ? (
        <div
          data-testid="feed-hero"
          className="mb-[11px] h-[104px] w-full overflow-hidden rounded-md bg-surface"
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
        className="mb-[5px] text-[15px] font-semibold leading-[1.4]"
        style={{ maxWidth: "30em" }}
      >
        {item.title}
      </h2>

      <div className="mb-[11px] text-[10px] leading-[1.6] text-text-muted">
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
          className="mb-[10px] border-l-2 border-accent pl-[10px] text-[12px] text-text-primary"
          style={{ maxWidth: "34em", lineHeight: 1.8 }}
        >
          {item.summary}
        </div>
      ) : null}

      {item.relevance ? (
        <div
          className="mb-[12px] text-[11px] text-accent"
          style={{ maxWidth: "34em", lineHeight: 1.75 }}
        >
          {item.relevance}
        </div>
      ) : null}

      {body?.bodyStatus === "snippet_only" ? (
        <div className="mb-[10px] text-[11px] text-text-muted">
          {t("feed.readerSnippetOnly")}
        </div>
      ) : null}

      {text ? (
        <div
          data-testid="feed-body"
          className="text-[12.5px] text-text-muted"
          style={{ maxWidth: "34em", lineHeight: 1.8 }}
        >
          {text.split(/\n{2,}/).map((paragraph, index) => (
            <p key={index} style={{ margin: "0 0 1.8em" }}>
              {paragraph}
            </p>
          ))}
        </div>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2.5 border-t border-border-subtle pt-2 text-[10px] leading-[1.6] text-text-muted">
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
