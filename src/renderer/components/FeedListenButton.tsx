/**
 * @module renderer/components/FeedListenButton
 *
 * header 里的收听入口：一颗播放/暂停图标（正在播时亮 accent 底），悬停 / 键盘聚焦
 * 向下弹出卡片 —— 封面、标题、第 x / 共 y 条、第 n / 共 m 句、逐句进度、跳过提示
 * 与上一条 / 下一条 / 关闭都在卡片里。
 *
 * 为什么不在右下角：那里是输入框的领地（实测遮住过）；不在底部通栏：那要永久占一条
 * 底边。header 右簇与面板按钮同族，且任何视图、任何系统位置都一样。
 */
import { useTranslation } from "react-i18next";
import {
  Headphones,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import {
  feedListenController,
  useFeedListen,
  useFeedListenInterrupts,
} from "../hooks/useFeedListen";
import { TitlebarButton } from "./TitlebarButton";

const CONTROL_CLASS =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-40";

export function FeedListenButton(): JSX.Element | null {
  const { t } = useTranslation();
  useFeedListenInterrupts();
  const listen = useFeedListen();
  const session = listen.session;
  if (!session) return null;

  const item = session.items[session.index]!;
  const total = session.items.length;
  const progress = listen.progress;
  // preparing 期间按下也是「暂停」（队列已建好），图标要跟着可暂停状态走
  const pausable = listen.status === "playing" || listen.status === "preparing";
  const percent =
    progress && progress.total > 0
      ? ((progress.current + 1) / progress.total) * 100
      : 0;

  return (
    <div
      data-testid="feed-listen-widget"
      className="titlebar-no-drag group relative"
    >
      <TitlebarButton
        label={
          pausable
            ? t("feed.listenPauseWith", { title: item.title })
            : t("feed.listenPlayWith", { title: item.title })
        }
        isOn={pausable}
        hideTooltip
        onClick={() => feedListenController().toggle()}
      >
        <span data-testid="feed-listen-button">
          {pausable ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
        </span>
      </TitlebarButton>

      {/* 悬停/聚焦展开的卡片：图标放不下的信息都在这里。
          z-[60] 要盖过内容区右上的产物面板（z-50），又低于灯箱（z-[100]）；
          `titlebar-no-drag` 写在卡片自己身上，不靠祖先继承。 */}
      <div
        data-testid="feed-listen-card"
        className="titlebar-no-drag invisible absolute right-0 top-full z-[60] w-[22rem] pt-2 opacity-0 transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        <div className="rounded-xl border border-border-subtle bg-background/95 p-2.5 shadow-elevated backdrop-blur">
          <div className="flex gap-2.5">
            {item.imageUrl ? (
              <img
                src={item.imageUrl}
                alt=""
                className="h-11 w-11 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-surface-active text-text-muted">
                <Headphones className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0">
              <div
                data-testid="feed-listen-title"
                className="text-sm font-semibold leading-[1.4] text-text-primary"
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {item.title}
              </div>
              <div className="mt-0.5 text-xs text-text-muted">
                <span className="truncate">{item.sourceHost}</span>
                <span className="px-1 opacity-45">·</span>
                <span className="text-accent">
                  {t("feed.listenPosition", {
                    index: session.index + 1,
                    total,
                  })}
                </span>
                {progress ? (
                  <>
                    <span className="px-1 opacity-45">·</span>
                    <span className="tabular-nums">
                      {t("feed.listenSentence", {
                        current: progress.current + 1,
                        total: progress.total,
                      })}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          </div>
          {progress ? (
            <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-surface-active">
              <div
                data-testid="feed-listen-progress"
                className="h-full bg-accent transition-[width] duration-200"
                style={{ width: `${percent}%` }}
              />
            </div>
          ) : null}
          {listen.skipped > 0 ? (
            <div
              data-testid="feed-listen-skipped"
              className="mt-1 text-xs text-error"
            >
              {t("feed.listenSkipped", { count: listen.skipped })}
            </div>
          ) : null}
          <div className="mt-1.5 flex items-center justify-center gap-1 border-t border-border-subtle pt-1.5">
            <button
              type="button"
              data-testid="feed-listen-prev"
              aria-label={t("feed.listenPrev")}
              disabled={session.index === 0}
              onClick={() => feedListenController().prev()}
              className={CONTROL_CLASS}
            >
              <SkipBack className="h-4 w-4" />
            </button>
            <button
              type="button"
              data-testid="feed-listen-toggle"
              aria-label={
                pausable ? t("feed.listenPause") : t("feed.listenPlay")
              }
              onClick={() => feedListenController().toggle()}
              className={`${CONTROL_CLASS} text-text-primary`}
            >
              {pausable ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              data-testid="feed-listen-next"
              aria-label={t("feed.listenNext")}
              disabled={session.index + 1 >= total}
              onClick={() => feedListenController().next()}
              className={CONTROL_CLASS}
            >
              <SkipForward className="h-4 w-4" />
            </button>
            <button
              type="button"
              data-testid="feed-listen-close"
              aria-label={t("feed.listenClose")}
              onClick={() => listen.stop()}
              className={`${CONTROL_CLASS} hover:text-error`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
