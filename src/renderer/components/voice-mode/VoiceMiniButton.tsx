/**
 * @module renderer/components/voice-mode/VoiceMiniButton
 *
 * header 里的语音入口：一颗**静态**状态点（亮 accent 表示语音会话在进行），
 * 悬停 / 键盘聚焦向下弹出卡片 —— 字幕、静音、结束都在卡片里。
 *
 * 不做活的星球球：那是 canvas，20px 下看不出差别，却要为此把 StarOrb、画笔与
 * 主题依赖引进 header。字幕由宿主算好发布（`voiceMiniCaption`），这里零规则 ——
 * 全屏浮层与这颗卡片共用同一份字幕规则，规则只在宿主一处。
 */
import { useTranslation } from "react-i18next";
import { Mic, MicOff, X } from "lucide-react";
import { useAppStore } from "../../store";
import { TitlebarButton } from "../TitlebarButton";

/** 卡片里那一行控件的统一样式。 */
const CARD_CONTROL_CLASS =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary";

export function VoiceMiniButton(): JSX.Element | null {
  const { t } = useTranslation();
  const open = useAppStore((s) => s.voiceModeOpen);
  const caption = useAppStore((s) => s.voiceMiniCaption);
  const activeView = useAppStore((s) => s.activeView);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const voiceSessionId = useAppStore((s) => s.voiceModeSessionId);
  const minimized = useAppStore((s) => s.voiceModeMinimized);
  const muted = useAppStore((s) => s.voiceModeMuted);
  const setMuted = useAppStore((s) => s.setVoiceModeMuted);
  const setMinimized = useAppStore((s) => s.setVoiceModeMinimized);
  const closeVoiceMode = useAppStore((s) => s.closeVoiceMode);
  // 全屏浮层打开时不渲染这个图标：卡片是 z-[60]（要压过产物面板的 z-50），
  // 而浮层是 z-50 且 Header 的祖先不产生层叠上下文 —— 卡片会浮在沉浸式浮层之上。
  // 收起（minimized）之后图标立刻回来。
  const overlayOpen =
    voiceSessionId !== null &&
    activeView === "chat" &&
    activeSessionId === voiceSessionId &&
    !minimized;
  if (!open || caption === null || overlayOpen) return null;

  return (
    <div
      data-testid="voice-mini-widget"
      className="titlebar-no-drag group relative"
    >
      <TitlebarButton
        label={t("voiceMode.expand")}
        isOn
        hideTooltip
        onClick={() => setMinimized(false)}
      >
        <span
          data-testid="voice-mini-orb"
          className="block h-4 w-4 rounded-full bg-accent"
        />
      </TitlebarButton>

      <div
        data-testid="voice-mini-card"
        /* z-[60]：要盖过内容区右上的产物面板（`ArtifactPanel.tsx` 是 z-50），
           又必须低于灯箱（z-[100]）。`titlebar-no-drag` 写在卡片自己身上，
           不靠祖先继承 —— 断言要能直接看见它。 */
        className="titlebar-no-drag invisible absolute right-0 top-full z-[60] w-[20rem] pt-2 opacity-0 transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        <div className="rounded-xl border border-border-subtle bg-background/95 p-2.5 shadow-elevated backdrop-blur">
          <p
            data-testid="voice-mini-caption"
            className="text-xs leading-[1.6] text-text-secondary"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {caption}
          </p>
          <div className="mt-2 flex items-center justify-center gap-1 border-t border-border-subtle pt-1.5">
            <button
              type="button"
              data-testid="voice-mini-mute"
              aria-label={
                muted ? t("voiceMode.unmuteMic") : t("voiceMode.muteMic")
              }
              onClick={() => setMuted(!muted)}
              className={CARD_CONTROL_CLASS}
            >
              {muted ? (
                <MicOff className="h-3.5 w-3.5" />
              ) : (
                <Mic className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              data-testid="voice-mini-end"
              aria-label={t("voiceMode.endVoice")}
              onClick={closeVoiceMode}
              className={`${CARD_CONTROL_CLASS} hover:text-error`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
