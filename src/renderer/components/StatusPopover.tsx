import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { QuotaSnapshot } from "../../shared/quota";
import type { ContextStatusDetails } from "./ChatInputBottomBar";
import { formatResetTime } from "../utils/i18n-format";
import { MENU_PANEL_CLASS } from "./menu-styles";

export interface StatusPopoverProps {
  contextUsagePercentage: number;
  contextRingColorClass: string;
  contextStatusDetails: ContextStatusDetails;
}

const RING_RADIUS = 9;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * 上下文占用圆环 + 点击弹出的状态面板。
 *
 * 面板只读、内部没有可交互元素，所以不需要焦点陷阱：Escape 与外部点击足够。
 */
export function StatusPopover({
  contextUsagePercentage,
  contextRingColorClass,
  contextStatusDetails,
}: StatusPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [quota, setQuota] = useState<QuotaSnapshot[]>([]);
  /** 预取只做一次：靠它区分「首次挂载」与「关闭后重开」。 */
  const prefetchedRef = useRef(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    // 需要刷新的两种情况：首次挂载预取（把实测 ~1s 的冷请求挪到用户点击之前），
    // 或面板被打开。关闭时不刷新——否则每次关闭都会多打一次请求。
    //
    // ⚠️ 这个 ref 与 React StrictMode 的 setup→cleanup→setup 相冲：第二次 setup 会被它
    // 拦住，而第一次的结果已被 cleanup 置 cancelled 丢弃 → 预取在 dev 下失效（打开面板时
    // 仍会正常刷新，所以只是退化成旧行为）。renderer/main.tsx:80 已移除 StrictMode（有注释），
    // 故现在不触发；若要包回 StrictMode，先改这里。
    if (!open && prefetchedRef.current) return;
    prefetchedRef.current = true;

    let cancelled = false;
    void (async () => {
      try {
        const snapshots = await window.electronAPI.quota.list();
        // **不清空**：保留上次结果（stale-while-revalidate，与 AccountMenu 一致），
        // 否则每次打开都会先空一下再出现，面板高度跟着跳。
        if (!cancelled) setQuota(snapshots);
      } catch {
        // IPC 级失败（handler 缺失 / 序列化失败）保持静默、保留上次结果——
        // 不再 setQuota([])。业务级失败（500/超时/非 JSON）不走这里，
        // 它们在主进程被吞成空数组、由聚合层的失败回落处理。
        //
        // 另：不要加回 `if (open && !providerId) return;` 那类通道闸门——它会让已登录的
        // 订阅在非该通道的会话（如 deepseek）里完全不显示。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <span
      ref={containerRef}
      className="relative inline-flex items-center justify-center"
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("statusPopover.ringTooltip")}
        className={`w-9 h-9 shrink-0 flex items-center justify-center rounded-2xl border border-border-subtle transition-colors ${
          open ? "bg-surface-hover" : "bg-background/60 hover:bg-surface-hover"
        }`}
      >
        <svg
          className="w-5 h-5 -rotate-90 text-text-muted"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            cx="12"
            cy="12"
            r={RING_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            className="opacity-20"
          />
          <circle
            cx="12"
            cy="12"
            r={RING_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            className={contextRingColorClass}
            strokeDasharray={`${(contextUsagePercentage / 100) * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
          />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("statusPopover.ringTooltip")}
          className={`${MENU_PANEL_CLASS} animate-menu-in-up absolute bottom-full right-0 z-30 mb-2 w-[340px] p-3 text-xs`}
        >
          <div className="flex items-center gap-2">
            <span className="w-[60px] shrink-0 text-text-secondary">
              {t("statusPopover.context")}
            </span>
            <span className="relative h-2 flex-1 overflow-hidden rounded-sm bg-surface-hover">
              <span
                className="absolute inset-y-0 left-0 rounded-sm bg-accent"
                style={{ width: `${contextUsagePercentage}%` }}
              />
            </span>
            <span className="w-[38px] shrink-0 text-right font-medium tabular-nums text-text-primary">
              {Math.round(contextUsagePercentage)}%
            </span>
          </div>
          <div className="pl-[70px] pt-0.5 text-[11px] tabular-nums text-text-muted">
            {contextStatusDetails.usedLabel} / {contextStatusDetails.totalLabel}
          </div>

          {quota.map((snapshot) =>
            snapshot.windows.length > 0 ? (
              <div
                key={snapshot.providerId}
                className="mt-2 border-t border-border-subtle pt-2"
              >
                <div className="flex items-baseline gap-1.5 pb-1 text-[11px] font-semibold text-text-secondary">
                  <span>{snapshot.providerName}</span>
                  {snapshot.planName && (
                    <span className="font-normal text-text-muted">
                      {snapshot.planName}
                    </span>
                  )}
                </div>
                <div className="border-l-2 border-border-subtle pl-2">
                  {snapshot.windows.map((window) => (
                    <div key={window.kind}>
                      <div className="flex items-center gap-2">
                        <span className="w-[60px] shrink-0 text-text-secondary">
                          {window.kind === "session"
                            ? t("statusPopover.windowSession")
                            : t("statusPopover.windowWeekly")}
                        </span>
                        <span className="relative h-2 flex-1 overflow-hidden rounded-sm bg-surface-hover">
                          <span
                            className="absolute inset-y-0 left-0 rounded-sm bg-accent"
                            style={{ width: `${window.usedPercent}%` }}
                          />
                        </span>
                        <span className="w-[38px] shrink-0 text-right font-medium tabular-nums text-text-primary">
                          {Math.round(window.usedPercent)}%
                        </span>
                      </div>
                      {window.resetsAt !== undefined && (
                        <div className="pl-[70px] pt-0.5 text-[11px] tabular-nums text-text-muted">
                          {t("statusPopover.resetAt", {
                            time: formatResetTime(window.resetsAt),
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null,
          )}

          {contextStatusDetails.cacheHitRate !== "--" && (
            <div className="mt-2 border-t border-border-subtle pt-2 text-[11px] text-text-muted">
              {t("statusPopover.cacheHitRate", {
                rate: contextStatusDetails.cacheHitRate,
              })}
            </div>
          )}
        </div>
      )}
    </span>
  );
}
