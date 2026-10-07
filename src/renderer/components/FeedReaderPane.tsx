import { useTranslation } from "react-i18next";

import type { FeedBodyPayload, FeedItemWithMeta } from "../../shared/feed";
import { MessageMarkdown } from "./MessageMarkdown";

export interface FeedReaderPaneProps {
  item: FeedItemWithMeta;
  body: FeedBodyPayload | null;
  onOpenInBrowser: (url: string) => void;
}

/**
 * 右栏：一个居中列，从上到下是 大图 → 标题 → 元信息 → 摘要块 →（只抓到片段时的提示）→ 正文摘录 → 底部行（相关性与出口）。
 *
 * **限宽 34em（= 34 个中文字符，低于 WCAG 1.4.8 给 CJK 的 40 字上限）由列自己承担，且必须在宽屏下居中**：
 * 不能靠加宽正文去填满右栏 —— 但列表固定 400px 之后右栏会涨到 1100px 以上，
 * 限宽的内容再左对齐就会把 500-600px 空白全堆在右边。居中让两侧均分。
 * 因此正文类元素不再各自写 maxWidth，一律由列承担；标题另按列内的 30em 行长单独限制。
 * （改前那三处内联 maxWidth 各自按自己的字号解析，实际是 442 与 476 两个宽度，不是同一个。）
 *
 * 字号用应用 token：标题 text-lg、正文 text-base（与聊天正文同档）、其余 text-xs；
 * 大图用 16:9 的比例锁而不是固定高度 —— 字号变化时图跟着一起缩放，不会被拉成横条。
 * 正文用 text-primary 而不是 muted：浅色主题下 muted 在 background-secondary 上只有 4.06:1，
 * 低于 WCAG AA 对正文的 4.5:1，而这是右栏里唯一要真读的一段字。
 * 「为什么和你相关」与出口同排：它在右栏是第二次出现的解释，不该再占一段 ——
 * 代价是它只剩约 320px 而被 truncate，而右栏又是它唯一的出现处（设计 §8.1），故带 title 兜底。
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
  const excerpt = body?.excerpt ?? null;
  const raw = body?.body ?? null;
  // 标签只在元信息行出现一处（底部那次已删，见设计 §8.1 第 4 条）。
  // body 还没到时（刚点开、正在取）先不显示：否则会先写「正文摘录」再翻成「· 本地化」
  const excerptLabel =
    body === null
      ? null
      : excerpt
        ? t("feed.readerExcerptLocalized")
        : t("feed.readerExcerpt");
  // 摘录是「纯文字」契约，而 MessageMarkdown 带 remark-math：一段里出现两个 $
  // （价格类内容很常见）会被当成公式、把文字吃掉。markdown 里 \$ 就是字面 $，
  // 渲染输出不留痕迹。回退态的 body 不转义 —— 那是页面 markdown，里面可能真有数学。
  const rendered = excerpt ? excerpt.replace(/\$/g, "\\$") : (raw ?? "");

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background-secondary px-5 py-3.5">
      <div
        data-testid="feed-reader-column"
        className="mx-auto w-full min-w-0"
        style={{ maxWidth: "34em" }}
      >
        {item.imageUrl ? (
          <div
            data-testid="feed-hero"
            className="mb-3 w-full overflow-hidden rounded-md bg-surface"
            style={{ aspectRatio: "16 / 9" }}
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
          <span>{excerptLabel}</span>
        </div>

        {item.summary ? (
          <div
            className="mb-3 border-l-2 border-accent pl-3 text-sm text-text-primary"
            style={{ lineHeight: 1.8 }}
          >
            {item.summary}
          </div>
        ) : null}

        {body?.bodyStatus === "snippet_only" ? (
          <div className="mb-3 text-xs text-text-muted">
            {t("feed.readerSnippetOnly")}
          </div>
        ) : null}

        {excerpt || raw ? (
          <div
            data-testid="feed-body"
            className="prose-feed text-base text-text-primary"
          >
            {excerpt ? null : (
              <p
                data-testid="feed-raw-note"
                className="mb-2 text-xs text-text-muted"
              >
                {t("feed.readerRawFallback")}
              </p>
            )}
            <MessageMarkdown normalizedText={rendered} />
          </div>
        ) : null}

        <div className="mt-2 flex items-baseline gap-3 border-t border-border-subtle pt-2 text-xs leading-[1.75] text-text-muted">
          <span
            data-testid="feed-relevance"
            className="min-w-0 flex-1 truncate text-accent"
            title={item.relevance ?? undefined}
          >
            {item.relevance}
          </span>
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
    </div>
  );
}
