import { Loader2, Mic, Sparkles, Undo2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "./Tooltip";
import type { VoiceInputController, VoiceStatus } from "../hooks/useVoiceInput";

export interface VoiceMicButtonProps {
  status: VoiceStatus;
  /** 0..1，录音时的实时响度。 */
  level: number;
  seconds: number;
  onToggle: () => void;
  onCancel: () => void;
  canPolish: boolean;
  canRevert: boolean;
  onPolish: () => void;
  onRevert: () => void;
}

function formatSeconds(total: number): string {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function VoiceMicButton({
  status,
  level,
  seconds,
  onToggle,
  onCancel,
  canPolish,
  canRevert,
  onPolish,
  onRevert,
}: VoiceMicButtonProps) {
  const { t } = useTranslation();
  // 转圈只用于「真的在跑」的两个态；整理中不转麦克风（麦克风并没在干活）。
  const busy = status === "requesting" || status === "finishing";
  // 但整理中也要锁住麦克风：hook 里 toggle() 只认 idle/recording，
  // 不锁的话用户会点一个没反应的按钮。
  const micDisabled = busy || status === "polishing";
  const recording = status === "recording";
  const label = recording ? t("chat.voiceStop") : t("chat.voiceStart");

  return (
    <div className="flex shrink-0 items-center gap-1">
      {recording && (
        <>
          {/* 音量条：让用户知道麦克风在工作（对齐微信） */}
          <div className="flex h-4 w-10 items-end gap-[2px]" aria-hidden>
            {[0.15, 0.3, 0.45, 0.6].map((threshold) => (
              <span
                key={threshold}
                className={`w-[3px] rounded-full transition-all ${
                  level >= threshold ? "bg-error" : "bg-border-muted"
                }`}
                style={{ height: `${Math.max(20, threshold * 100)}%` }}
              />
            ))}
          </div>
          <span className="text-xs tabular-nums text-error">
            {formatSeconds(seconds)}
          </span>
        </>
      )}

      {!recording && (canPolish || canRevert) && (
        <Tooltip
          label={canRevert ? t("chat.voiceRevert") : t("chat.voicePolish")}
        >
          <button
            type="button"
            aria-label={
              canRevert ? t("chat.voiceRevert") : t("chat.voicePolish")
            }
            disabled={status === "polishing"}
            onClick={canRevert ? onRevert : onPolish}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              canRevert
                ? "bg-surface-hover text-text-secondary hover:text-text-primary"
                : "bg-accent/10 text-accent hover:bg-accent/20"
            }`}
          >
            {status === "polishing" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : canRevert ? (
              <Undo2 className="h-4 w-4" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
          </button>
        </Tooltip>
      )}

      <Tooltip label={label}>
        <button
          type="button"
          aria-label={label}
          disabled={micDisabled}
          onClick={onToggle}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            recording
              ? "bg-error/10 text-error"
              : "text-text-muted hover:bg-surface-hover hover:text-text-primary"
          }`}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Mic className={`h-4 w-4 ${recording ? "animate-pulse" : ""}`} />
          )}
        </button>
      </Tooltip>

      {recording && (
        <Tooltip label={t("chat.voiceCancel")}>
          <button
            type="button"
            aria-label={t("chat.voiceCancel")}
            onClick={onCancel}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * 把 `useVoiceInput` 的控制器适配成按钮的 props。
 *
 * 放在这里而不是两个宿主各写一份：ChatView 与 WelcomeView 都要这一层。
 * 控制器的方法返回 Promise，按钮只要 `() => void`，所以在这里丢掉返回值 ——
 * 整理失败的通知由钩子自己发（见 `UseVoiceInputOptions.onPolishFailed`）。
 */
export function toMicButtonProps(
  voice: VoiceInputController,
): VoiceMicButtonProps {
  return {
    status: voice.status,
    level: voice.level,
    seconds: voice.seconds,
    canPolish: voice.canPolish,
    canRevert: voice.canRevert,
    onToggle: voice.toggle,
    onCancel: () => void voice.cancel(),
    onPolish: () => void voice.polish(),
    onRevert: voice.revert,
  };
}
