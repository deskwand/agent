/**
 * SandboxSetupDialog - Shows sandbox initialization progress at app startup
 * Supports light/dark theme
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SandboxSetupProgress, SandboxSetupPhase } from "../types";
import { getSandboxSetupDisplayText } from "../utils/sandbox-i18n";
import { OccludingAlertDialog } from "./ui/occluding-dialog";
import {
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "./ui/alert-dialog";

interface Props {
  progress: SandboxSetupProgress | null;
  onComplete?: () => void;
}

// Phase display configuration
const phaseConfig: Record<SandboxSetupPhase, { icon: string }> = {
  checking: { icon: "🔍" },
  creating: { icon: "📦" },
  starting: { icon: "🚀" },
  installing_node: { icon: "💚" },
  installing_python: { icon: "🐍" },
  installing_pip: { icon: "📦" },
  installing_deps: { icon: "📚" },
  ready: { icon: "✅" },
  skipped: { icon: "⚡" },
  error: { icon: "❌" },
};

/**
 * 沙箱初始化进度弹窗。
 *
 * 外壳由 shadcn 的 AlertDialog 承担 —— 选它而不是 Dialog，是因为这个弹窗
 * **不可关闭**：沙箱还在配，关掉会让用户以为失败了。AlertDialogContent
 * 天生没有内置关闭键、也不响应遮罩点击，所以下面的 onOpenChange 只作 no-op
 * 即可，且无需任何 CSS hack。真正的出口只有两个：错误态的两个按钮，
 * 以及 ready/skipped 的自动关闭。
 *
 * occlusion 是**派生**的（Boolean(progress) && isVisible），交给包装组件的 `open`。
 * 原实现把这个表达式直接交给 useBrowserOcclusion，语义不变。
 *
 * `isVisible` 是内部 state（初值 true），不是 prop；`isOccluding` 为假时包装
 * 组件会释放引用计数。
 */
export function SandboxSetupDialog({ progress, onComplete }: Props) {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(true);
  const [isRetrying, setIsRetrying] = useState(false);

  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClose = useCallback(() => {
    // 只保留这一段 500ms。原实现先 setFadeOut(true) 驱动一层 CSS 过渡再收起；
    // 那个 state 已删除（全仓只有「声明 / 置 true / 用在 className」三处）。
    //
    // ⚠️ 但要如实说清楚：**淡出效果也随之没了**，并没有被 Radix 的动画接手。
    // 下面 `if (!progress || !isVisible) return null` 这个早退让派生出来的
    // `open` 在组件挂载期间**恒为 true** —— Radix 看不到状态迁移，
    // 所以 `data-[state=closed]` 的退场动画永远不会跑。于是 ready/skipped 之后
    // 弹窗会满不透明地停 1500ms，再在 2000ms 处瞬间消失（原先是那 500ms 里渐隐）。
    // 这是 D2 授权范围内的观感变化，已记入 ledger 供 §9.3 截图验收对照。
    //
    // **这 500ms 本身要保留** —— 它现在是「收起前的缓冲」，删了会让 onComplete
    // 提前到 1500ms，而调用方可能依赖 2000ms 这个时机推进流程
    //（sandbox-setup-dialog-shell.test.tsx 把两段计时钉死了）。
    closeTimerRef.current = setTimeout(() => {
      setIsVisible(false);
      onComplete?.();
    }, 500);
  }, [onComplete]);

  // Cleanup close timer on unmount
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const handleRetryLima = async () => {
    if (!window.electronAPI?.sandbox?.retryLimaSetup) {
      return;
    }
    setIsRetrying(true);
    try {
      const result = await window.electronAPI.sandbox.retryLimaSetup();
      if (!result?.success) {
        setIsRetrying(false);
      }
    } catch (error) {
      console.error("[SandboxSetupDialog] Retry Lima failed:", error);
      setIsRetrying(false);
    }
  };

  useEffect(() => {
    if (progress?.phase === "ready" || progress?.phase === "skipped") {
      // Delay before fade out for success states
      const timer = setTimeout(() => {
        handleClose();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [progress?.phase, handleClose]);

  useEffect(() => {
    if (progress && progress.phase !== "error") {
      setIsRetrying(false);
    }
  }, [progress]);

  if (!progress || !isVisible) {
    return null;
  }

  const config = phaseConfig[progress.phase];
  const isComplete = progress.phase === "ready" || progress.phase === "skipped";
  const isError = progress.phase === "error";
  const isMac = window.electronAPI?.platform === "darwin";
  const displayText = getSandboxSetupDisplayText(t, progress);

  return (
    <OccludingAlertDialog
      open={Boolean(progress) && isVisible}
      onOpenChange={() => {
        // 不可关闭：沙箱还在配置，关掉会让用户以为失败了。
        // 出口只有错误态的「继续」「重试」两个按钮，以及 ready/skipped 的自动关闭。
      }}
    >
      <AlertDialogContent className="max-w-md w-full overflow-hidden gap-0 p-0">
        {/* Header */}
        <div className="bg-background-secondary/90 px-6 py-5 border-b border-border-muted">
          <div className="flex items-center gap-3">
            <div className="text-3xl animate-pulse">{config.icon}</div>
            <div>
              <AlertDialogTitle className="text-lg font-semibold text-text-primary">
                {t("sandbox.setupTitle")}
              </AlertDialogTitle>
              {/* Description 供读屏补充一句上下文（Radix 不强制要求） */}
              <AlertDialogDescription className="text-sm text-text-secondary">
                {t("sandbox.setupSubtitle")}
              </AlertDialogDescription>
            </div>
          </div>
        </div>

        {/* Progress Content */}
        <div className="px-6 py-5">
          {/* Status Message */}
          <div className="flex items-start gap-3 mb-4">
            <div
              className={`text-xl ${
                isComplete
                  ? "text-success"
                  : isError
                    ? "text-error"
                    : "text-primary"
              }`}
            >
              {config.icon}
            </div>
            <div className="flex-1">
              <p
                className={`font-medium ${
                  isComplete
                    ? "text-success"
                    : isError
                      ? "text-error"
                      : "text-primary"
                }`}
              >
                {displayText.message}
              </p>
              {displayText.detail && (
                <p className="text-sm text-text-muted mt-1">
                  {displayText.detail}
                </p>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          {progress.progress !== undefined && !isError && (
            <div className="mt-4">
              <div className="h-2 bg-surface-muted rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ease-out rounded-full ${
                    isComplete ? "bg-success" : "bg-primary"
                  }`}
                  style={{ width: `${progress.progress}%` }}
                />
              </div>
              <div className="flex justify-between mt-2 text-xs text-text-muted">
                <span>{t("sandbox.progressLabel")}</span>
                <span>{progress.progress}%</span>
              </div>
            </div>
          )}

          {/* Error Display */}
          {isError && progress.error && (
            <div className="mt-4 p-3 bg-error/10 border border-error/30 rounded-xl">
              <p className="text-sm text-error">{progress.error}</p>
              <p className="text-xs text-text-muted mt-2">
                {t("sandbox.continuingNative")}
              </p>
            </div>
          )}

          {/* Continue / Retry Buttons for Error State */}
          {isError && (
            <div className="mt-4 flex flex-col gap-3">
              {isMac && (
                <button
                  onClick={handleRetryLima}
                  disabled={isRetrying}
                  className="w-full py-2.5 px-4 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isRetrying
                    ? t("sandbox.retryingLima")
                    : t("sandbox.retryLima")}
                </button>
              )}
              <button
                onClick={handleClose}
                className={`w-full py-2.5 px-4 rounded-xl font-medium transition-colors ${
                  isMac
                    ? "bg-surface hover:bg-surface-muted text-text-primary border border-border"
                    : "bg-primary hover:bg-primary/90 text-primary-foreground"
                }`}
              >
                {t("sandbox.continueNative")}
              </button>
            </div>
          )}

          {/* Completion Message */}
          {isComplete && (
            <div className="mt-4 p-3 bg-success/10 border border-green-500/30 rounded-xl">
              <p className="text-sm text-success">
                {progress.phase === "ready"
                  ? t("sandbox.configuredSuccess")
                  : t("sandbox.nativeFallbackSuccess")}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-background-secondary/70 border-t border-border-muted">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>
              {window.electronAPI?.platform === "win32"
                ? t("sandbox.footerWsl")
                : window.electronAPI?.platform === "darwin"
                  ? t("sandbox.footerLima")
                  : t("sandbox.footerNative")}
            </span>
            {!isComplete && !isError && (
              <span className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 bg-primary rounded-full animate-pulse" />
                {t("sandbox.configuring")}
              </span>
            )}
          </div>
        </div>
      </AlertDialogContent>
    </OccludingAlertDialog>
  );
}
