import { Fragment, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";

import { parseRunReasons } from "../../shared/feed";
import { useAppStore } from "../store";
import { FeedItemRow } from "./FeedItemRow";
import { FeedReaderPane, FeedReaderPlaceholder } from "./FeedReaderPane";

const DAY_MS = 24 * 60 * 60 * 1000;

function phaseKey(phase: string): string {
  switch (phase) {
    case "signals":
      return "feed.phaseSignals";
    case "queries":
      return "feed.phaseQueries";
    case "collect":
      return "feed.phaseCollect";
    case "fetch":
      return "feed.phaseFetch";
    case "compose":
      return "feed.phaseCompose";
    case "excerpt":
      return "feed.phaseExcerpt";
    default:
      return "feed.phaseImage";
  }
}

function groupKey(createdAt: number, now: number): string {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (createdAt >= startOfToday) return "feed.groupToday";
  if (createdAt >= startOfToday - DAY_MS) return "feed.groupYesterday";
  return "feed.groupEarlier";
}

/**
 * 四种状态（设计 §8.4）：
 * 关着且无条目 → 引导页；关着且有条目 → 正常列表 + 「自动更新已关闭」；
 * 开着且无条目 → 空提示；开着且有条目 → 正常列表。
 * 「关着不允许把已生成的内容藏起来」是硬要求。
 */
export function FeedView(): JSX.Element {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [reasonsOpen, setReasonsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showActionsOnFirstRow, setShowActionsOnFirstRow] = useState(true);

  const enabled = useAppStore((state) => state.feedEnabled);
  const items = useAppStore((state) => state.feedItems);
  const unread = useAppStore((state) => state.feedUnread);
  const phase = useAppStore((state) => state.feedGenPhase);
  const lastRun = useAppStore((state) => state.feedLastRun);
  const openId = useAppStore((state) => state.feedOpenId);
  const body = useAppStore((state) => state.feedBody);
  const blockedTopics = useAppStore((state) => state.feedBlockedTopics);
  const startFeedListen = useAppStore((state) => state.startFeedListen);
  const feedListenNotice = useAppStore((state) => state.feedListenNotice);
  const refreshFeed = useAppStore((state) => state.refreshFeed);
  const setFeedEnabled = useAppStore((state) => state.setFeedEnabled);
  const markFeedRead = useAppStore((state) => state.markFeedRead);
  const markAllFeedRead = useAppStore((state) => state.markAllFeedRead);
  const dismissFeedItem = useAppStore((state) => state.dismissFeedItem);
  const openFeedItem = useAppStore((state) => state.openFeedItem);
  const setFeedBlockedTopics = useAppStore(
    (state) => state.setFeedBlockedTopics,
  );
  // 返回聊天：与 Vault / 用量 / 连接器页同一套入口（图标、aria-label、类名都一致）
  const setActiveView = useAppStore((state) => state.setActiveView);

  useEffect(() => {
    void refreshFeed();
  }, [refreshFeed]);

  const visible = useMemo(
    () =>
      filter === "unread"
        ? items.filter((item) => item.read_at === null)
        : items,
    [filter, items],
  );
  const selected = items.find((item) => item.id === openId) ?? null;
  const now = Date.now();

  // 「下次更新」= 上次**成功**的 run + 24h（设计 §7）；没有成功过就说「还没更新过」
  const remainingMs =
    lastRun && lastRun.status !== "failed"
      ? lastRun.started_at + DAY_MS - now
      : null;
  const nextUpdateText =
    remainingMs === null
      ? t("feed.neverUpdated")
      : remainingMs >= 60 * 60 * 1000
        ? t("feed.hoursLater", {
            count: Math.max(1, Math.round(remainingMs / 3_600_000)),
          })
        : t("feed.minutesLater", {
            count: Math.max(1, Math.round(remainingMs / 60_000)),
          });

  const reasons = useMemo(
    () => parseRunReasons(lastRun?.queries ?? null),
    [lastRun?.queries],
  );

  // 手动刷新的限流反馈：refreshNow 返回 { started:false, reason:"tooSoon" } 时告诉用户，
  // 不要无声无息（设计 §9 的限流是行为，不是错误）
  const refreshNow = async () => {
    const result = await window.electronAPI.feed.refreshNow();
    if (result.started) {
      setNotice(null);
      return;
    }
    if (result.reason === "tooSoon") {
      setNotice(t("feed.tooSoon", { minutes: 10 }));
    }
  };

  // 「听全部」按下后一条有稿的都没有：就地提示（store 里那个标记是一次性的）
  useEffect(() => {
    if (feedListenNotice !== "empty") return;
    setNotice(t("feed.listenEmpty"));
    useAppStore.setState({ feedListenNotice: null });
  }, [feedListenNotice, t]);

  if (!enabled && items.length === 0) {
    return (
      <div
        data-testid="feed-view"
        className="flex h-full flex-col bg-background"
      >
        <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
          <button
            type="button"
            data-testid="feed-back"
            onClick={() => setActiveView("chat")}
            aria-label={t("common.back")}
            className="-ml-1.5 rounded-lg p-1.5 transition-colors hover:bg-surface-hover"
          >
            <ArrowLeft className="h-5 w-5 text-text-secondary" />
          </button>
          <span className="text-base font-semibold">{t("feed.railLabel")}</span>
        </div>
        <div className="max-w-[34em] px-6 py-6">
          <div className="mb-2 text-base font-semibold">
            {t("feed.onboardingTitle")}
          </div>
          <div className="text-sm text-text-muted" style={{ lineHeight: 1.8 }}>
            {t("feed.onboardingBody")}
          </div>
          <ul
            className="mb-4 mt-3 space-y-1 text-sm text-text-muted"
            style={{ lineHeight: 1.8 }}
          >
            <li>· {t("feed.onboardingBullet1")}</li>
            <li>· {t("feed.onboardingBullet2")}</li>
            <li>· {t("feed.onboardingBullet3")}</li>
          </ul>
          <button
            type="button"
            data-testid="feed-enable"
            onClick={() => void setFeedEnabled(true)}
            className="rounded-md bg-accent px-4 py-1.5 text-xs font-semibold text-accent-foreground"
          >
            {t("feed.onboardingCta")}
          </button>
        </div>
      </div>
    );
  }

  const imageCount = items.filter((item) => item.image_status === "ok").length;

  return (
    <div data-testid="feed-view" className="flex h-full flex-col bg-background">
      <style>{`.feed-row:hover [data-testid="feed-actions"],.feed-row:focus-within [data-testid="feed-actions"]{opacity:1 !important}`}</style>

      <div className="flex items-start gap-3 border-b border-border-subtle px-4 pb-2.5 pt-3.5">
        <button
          type="button"
          data-testid="feed-back"
          onClick={() => setActiveView("chat")}
          aria-label={t("common.back")}
          className="-ml-1.5 mt-0.5 rounded-lg p-1.5 transition-colors hover:bg-surface-hover"
        >
          <ArrowLeft className="h-5 w-5 text-text-secondary" />
        </button>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-text-primary">
            {t("feed.railLabel")}
          </h1>
          <p className="text-xs leading-[1.75] tabular-nums text-text-muted">
            {phase
              ? t("feed.progress", { phase: t(phaseKey(phase)) })
              : enabled
                ? t("feed.nextUpdate", { time: nextUpdateText })
                : t("feed.autoOff")}
          </p>
        </div>
        <span className="flex-1" />
        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="button"
            data-testid="feed-refresh"
            disabled={Boolean(phase)}
            onClick={() => void refreshNow()}
            className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-accent-foreground disabled:opacity-50"
          >
            {t("feed.refresh")}
          </button>
          <button
            type="button"
            data-testid="feed-listen-all"
            onClick={() => void startFeedListen()}
            className="rounded-md border border-border px-2.5 py-1.5 text-xs font-semibold text-text-primary"
          >
            {t("feed.listenAll")}
          </button>
          <div className="relative">
            <button
              type="button"
              data-testid="feed-more"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className="px-1 text-xs text-text-muted"
            >
              ⋯
            </button>
            {menuOpen ? (
              <div className="absolute right-0 top-6 z-10 w-[154px] rounded-md border border-border bg-surface p-1 shadow-elevated">
                <button
                  type="button"
                  data-testid="feed-mark-all-read"
                  onClick={() => {
                    setMenuOpen(false);
                    void markAllFeedRead();
                  }}
                  className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-surface-hover"
                >
                  {t("feed.markAllRead")}
                </button>
                <button
                  type="button"
                  data-testid="feed-toggle-auto"
                  onClick={() => {
                    setMenuOpen(false);
                    void setFeedEnabled(!enabled);
                  }}
                  className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-surface-hover"
                >
                  {enabled ? t("feed.pauseAuto") : t("feed.resumeAuto")}
                </button>
                <button
                  type="button"
                  data-testid="feed-clear-all"
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirmClear(true);
                  }}
                  className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-surface-hover"
                >
                  {t("feed.clearAll")}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {lastRun?.status === "failed" ? (
        <div
          data-testid="feed-error"
          className="flex items-center gap-2 border-b border-error/35 bg-error/10 px-4 py-1.5 text-xs text-error"
        >
          <span>{t("feed.errorSearchFailed")}</span>
          <span className="flex-1" />
          <button type="button" onClick={() => void refreshNow()}>
            {t("feed.errorRetry")}
          </button>
        </div>
      ) : null}

      {lastRun?.status === "partial" ? (
        <div className="border-b border-border-subtle px-4 py-1.5 text-xs text-text-muted">
          {t("feed.partial")}
        </div>
      ) : null}

      {notice ? (
        <div className="border-b border-border-subtle px-4 py-1.5 text-xs text-text-muted">
          {notice}
        </div>
      ) : null}

      <div
        data-testid="feed-filters"
        className="flex items-center gap-3 px-4 pt-2 text-xs"
      >
        <button
          type="button"
          onClick={() => {
            setFilter("all");
            setShowActionsOnFirstRow(false);
          }}
          className={filter === "all" ? "text-accent" : "text-text-muted"}
        >
          {t("feed.filterAll")}
        </button>
        <button
          type="button"
          onClick={() => {
            setFilter("unread");
            setShowActionsOnFirstRow(false);
          }}
          className={filter === "unread" ? "text-accent" : "text-text-muted"}
        >
          {t("feed.filterUnread", { count: unread })}
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/*
          列表列宽：目标 32.5rem（16px 根字号下 = 520px），受「页宽 40%」与「下限 25rem」两重约束。
          用 rem 而不是 px，是因为字号设置缩放的是根字号 —— 写死 px 的话字号调大后每行装的中文字数会变少。

          **下限也必须带百分比**：min-width 的优先级高于 width，所以下限写死成 25rem 时，
          字号拉到 20（根字号 22.86px）会让它变成 571px，在 800px 窗口下吃掉 77% 页宽、
          把右栏正文压到 133px ≈ 6.6 字/行（真实浏览器实测）。写成 min(25rem,50%) 后同样是
          800px 窗口，右栏能拿回 332px ≈ 16.6 字/行。

          列宽带来的收益：带缩略图时标题列 = 520 − 32(padding) − 88(图) − 12(间距) = 388px ≈ 27 字
          （未读行再扣 13px 的未读点与间距，≈ 26.8 字）；400px 时只有 268px ≈ 19 字，中文长标题要折三行。
          窗口窄于约 1356px 时列表吃不满 520，这个数字按比例缩小。
        */}
        <div
          data-testid="feed-list-column"
          className="w-[min(32.5rem,40%)] min-w-[min(25rem,50%)] shrink-0 overflow-y-auto"
        >
          {visible.length === 0 ? (
            <div
              className="px-6 py-6 text-sm text-text-muted"
              style={{ lineHeight: 1.8 }}
            >
              {items.length === 0 ? (
                <>
                  <div className="mb-1 font-semibold text-text-primary">
                    {t("feed.emptyTitle")}
                  </div>
                  {t("feed.emptyBody")}
                </>
              ) : (
                // 有条目、只是当前筛选下没有：不能说「还没有内容」（那是另一种状态）
                t("feed.filterEmpty")
              )}
            </div>
          ) : null}

          {visible.map((item, index) => {
            const key = groupKey(item.created_at, now);
            const previousKey =
              index === 0 ? null : groupKey(visible[index - 1].created_at, now);
            return (
              <Fragment key={item.id}>
                {key !== previousKey ? (
                  <div className="sticky top-0 z-10 bg-background px-4 pb-1.5 pt-2.5 text-xs font-medium tracking-wider text-text-muted">
                    {t(key)}
                  </div>
                ) : null}
                <div className="feed-row">
                  <FeedItemRow
                    item={item}
                    selected={item.id === openId}
                    showActionsAlways={showActionsOnFirstRow && index === 0}
                    onOpen={(id) => {
                      setShowActionsOnFirstRow(false);
                      void openFeedItem(id);
                    }}
                    onRead={(id) => {
                      // 用过一次就收起「首屏常显」的提示（否则它会跟着新的一条继续演）
                      setShowActionsOnFirstRow(false);
                      void markFeedRead(id);
                    }}
                    onDismiss={(id) => {
                      setShowActionsOnFirstRow(false);
                      void dismissFeedItem(id);
                    }}
                  />
                </div>
              </Fragment>
            );
          })}
        </div>

        {items.length > 0 ? (
          <div
            data-testid="feed-reader"
            className="min-w-0 flex-1 border-l border-border-subtle"
          >
            {selected ? (
              <FeedReaderPane
                item={selected}
                body={body}
                onOpenInBrowser={(url) =>
                  void window.electronAPI.openExternal(url)
                }
              />
            ) : (
              // 两栏常驻：未选中时也占住右栏，点条目时列表不会突然变窄（设计 §8.3）
              <FeedReaderPlaceholder />
            )}
          </div>
        ) : null}
      </div>

      <div className="relative border-t border-border-subtle px-4 py-2 text-xs text-text-muted">
        {confirmClear ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40">
            <div className="w-[360px] rounded-lg border border-border bg-surface p-4">
              <div className="mb-1 text-base font-semibold">
                {t("feed.clearAllConfirmTitle")}
              </div>
              <div
                className="mb-3 text-sm text-text-muted"
                style={{ lineHeight: 1.8 }}
              >
                {t("feed.clearAllConfirmBody")}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="text-xs text-text-muted"
                >
                  {t("feed.cancel")}
                </button>
                <button
                  type="button"
                  data-testid="feed-clear-confirm"
                  onClick={() => {
                    setConfirmClear(false);
                    void window.electronAPI.feed
                      .clearAll()
                      .then(() => refreshFeed());
                  }}
                  className="rounded-md bg-error px-3 py-1.5 text-xs font-semibold text-error-foreground"
                >
                  {t("feed.clearAllConfirm")}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <button
          type="button"
          data-testid="feed-reasons-toggle"
          onClick={() => setReasonsOpen((open) => !open)}
        >
          {t("feed.reasonsTitle")} {reasonsOpen ? "▴" : "▾"}
        </button>
        <span className="pl-2.5 tabular-nums">
          {t("feed.reasonsSummary", {
            queries: reasons.length,
            candidates: lastRun?.candidate_count ?? 0,
            items: lastRun?.item_count ?? 0,
            images: imageCount,
          })}
        </span>

        {reasonsOpen && reasons.length > 0 ? (
          <div className="mt-2 space-y-1.5">
            {reasons.map((query) => {
              const blocked = blockedTopics.includes(query.topic);
              return (
                <div key={query.q} className="flex items-center gap-2">
                  <span className="text-text-primary">{query.q}</span>
                  <span className="rounded-sm bg-accent-muted px-1.5 text-accent">
                    {query.topic}
                  </span>
                  <span className="text-xs">
                    {query.reason || t("feed.reasonsFromMemory")}
                  </span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    data-testid={`feed-block-${query.topic}`}
                    onClick={() =>
                      void setFeedBlockedTopics(
                        blocked
                          ? blockedTopics.filter(
                              (topic) => topic !== query.topic,
                            )
                          : [...blockedTopics, query.topic],
                      )
                    }
                    className={blocked ? "text-text-muted" : "text-accent"}
                  >
                    {blocked
                      ? t("feed.reasonsBlocked")
                      : t("feed.reasonsBlockTopic")}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
