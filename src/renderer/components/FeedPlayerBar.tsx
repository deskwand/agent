/**
 * @module renderer/components/FeedPlayerBar
 *
 * 全局收听挂件（右下角），**不占布局**：形态与让位逻辑照语音模式最小化的
 * `VoiceMiniBar`（`fixed right-4`、胶囊 `max-w-[22rem]`、`rounded-full`、
 * `bg-background/95` + `backdrop-blur` + `shadow-elevated`、有沙箱 Toast 时抬到
 * `bottom-20`）。
 *
 * 为什么不是底部通栏：聊天的输入框就在视口底部居中（`ChatView` 的
 * `max-w-[920px]`），任何占据底部中带的条都会与它抢位置 —— 实测被盖住过。
 * 挂件待在右下角的空白里，既不遮输入框、也不缩短内容区。
 *
 * 收起态只留四件事：封面 · 标题（截断）· 播放/暂停 · 关闭。放不下的
 * （逐句进度、第 x/共 y 条、上一条/下一条、跳过提示）都放进**悬停/聚焦展开**的
 * 卡片里；卡片自己带 `pb-2` 当悬停桥，鼠标从胶囊往上走不会中途丢 hover。
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
import { useSandboxSyncStatus } from "../store/selectors";

/** 卡片里那一行控件的统一样式（与 VoiceMiniBar 的按钮同款）。 */
const CONTROL_CLASS =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-40";

export function FeedPlayerBar(): JSX.Element | null {
  const { t } = useTranslation();
  useFeedListenInterrupts();
  const listen = useFeedListen();
  // 右下角已经有沙箱同步 Toast 时向上让位，别互相盖住（照 VoiceMiniBar）。
  const lifted = useSandboxSyncStatus() !== null;
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
      data-testid="feed-player-bar"
      className={`fixed right-4 z-40 ${lifted ? "bottom-20" : "bottom-4"}`}
    >
      <div className="group relative">
        {/* 悬停/聚焦展开的卡片：收起态放不下的信息都在这里 */}
        <div
          data-testid="feed-player-card"
          className="invisible absolute bottom-full right-0 w-[22rem] pb-2 opacity-0 transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
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
                  data-testid="feed-player-card-title"
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
                  data-testid="feed-player-progress"
                  className="h-full bg-accent transition-[width] duration-200"
                  style={{ width: `${percent}%` }}
                />
              </div>
            ) : null}
            {listen.skipped > 0 ? (
              <div
                data-testid="feed-player-skipped"
                className="mt-1 text-xs text-error"
              >
                {t("feed.listenSkipped", { count: listen.skipped })}
              </div>
            ) : null}
            <div className="mt-1.5 flex items-center justify-center gap-1 border-t border-border-subtle pt-1.5">
              <button
                type="button"
                data-testid="feed-player-prev"
                aria-label={t("feed.listenPrev")}
                disabled={session.index === 0}
                onClick={() => feedListenController().prev()}
                className={CONTROL_CLASS}
              >
                <SkipBack className="h-4 w-4" />
              </button>
              <button
                type="button"
                data-testid="feed-player-toggle"
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
                data-testid="feed-player-next"
                aria-label={t("feed.listenNext")}
                disabled={session.index + 1 >= total}
                onClick={() => feedListenController().next()}
                className={CONTROL_CLASS}
              >
                <SkipForward className="h-4 w-4" />
              </button>
              <button
                type="button"
                data-testid="feed-player-close"
                aria-label={t("feed.listenClose")}
                onClick={() => listen.stop()}
                className={`${CONTROL_CLASS} hover:text-error`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* 收起态：与语音小球同尺寸的胶囊 */}
        <div className="flex max-w-[22rem] items-center gap-2 rounded-full border border-border-subtle bg-background/95 px-2 py-1.5 shadow-elevated backdrop-blur">
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt=""
              className="h-10 w-10 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-active text-text-muted">
              <Headphones className="h-4 w-4" />
            </span>
          )}
          <p
            data-testid="feed-player-title"
            className="min-w-0 flex-1 truncate text-xs text-text-secondary"
          >
            {item.title}
          </p>
          <button
            type="button"
            data-testid="feed-player-toggle-capsule"
            aria-label={pausable ? t("feed.listenPause") : t("feed.listenPlay")}
            onClick={() => feedListenController().toggle()}
            className={CONTROL_CLASS}
          >
            {pausable ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            data-testid="feed-player-close-capsule"
            aria-label={t("feed.listenClose")}
            onClick={() => listen.stop()}
            className={`${CONTROL_CLASS} hover:text-error`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
