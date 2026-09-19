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
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    // 无条件先清空：关闭、重新打开都不该闪出上一次抓取的结果。
    // ⚠️ 这里清空是「不要闪现旧数据」，**不是**按通道过滤。
    // 历史上曾有 `if (!open || !providerId) return;` 这道闸门，它会让
    // 已登录的订阅在非该通道的会话（如 deepseek）里完全不显示——不要加回来。
    setQuota([]);

    // 这里**不能**再按通道 id 做条件：非 OAuth 会话（如 deepseek）也必须查，
    // 否则已登录的订阅额度不会显示——这正是本次要修的观感问题。
    if (!open) return;

    let cancelled = false;
    void (async () => {
      try {
        const snapshots = await window.electronAPI.quota.list();
        if (!cancelled) setQuota(snapshots);
      } catch {
        // handler 缺失 / 序列化失败都会 reject：按「这次没有额度数据」处理
        if (!cancelled) setQuota([]);
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
