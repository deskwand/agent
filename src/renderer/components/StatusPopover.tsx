import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { QuotaSnapshot } from "../../shared/quota";
import type { ContextStatusDetails } from "./ChatInputBottomBar";
import { formatResetTime } from "../utils/i18n-format";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Button } from "./app-button";
import { AppProgress } from "./app-progress";

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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span className="relative inline-flex items-center justify-center">
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            type="button"
            // onClick / aria-haspopup / aria-expanded 三样都由 Radix 的 Trigger 管 ——
            // 手写会和它打架（两边各切一次 = 等于不切换）
            aria-label={t("statusPopover.ringTooltip")}
            // ⚠️ `[&_svg]:size-5` 是给 `<Button>` base 擦屁股（与活动 chip 同族的迁移回归）：环自己写的
            // `w-5 h-5`（20px）被 base 的 `[&_svg]:size-4`（`.cls svg` 特指度 0,1,1）顶成 16px ——
            // Chromium + 构建 CSS 实测 16px，写回后 20px == 迁移前的原生 `<button>`（`67889f23^`）。
            // 这个触发器里只有环一个 svg，所以 `size-5` 不会误伤别处。
            className={`w-9 h-9 shrink-0 flex items-center justify-center rounded-2xl border border-border/40 transition-colors [&_svg]:size-5 ${
              open ? "bg-accent" : "bg-background/60 hover:bg-accent"
            }`}
          >
            <svg
              className="w-5 h-5 -rotate-90 text-muted-foreground"
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
          </Button>
        </PopoverTrigger>
      </span>

      <PopoverContent
        side="top"
        align="end"
        // ⚠️ 这一行是**实测证伪后加上的**，不是投机：先不写它跑那条焦点用例，
        // 结果红了（`expected <div data-side="top"> … to be <Button variant="ghost">`）——
        // 即 Radix 的 PopoverContent 打开时确实会把焦点移进内容。
        // 原实现的焦点一直留在环形按钮上（面板只读、没有可聚焦元素），
        // 所以必须阻止，否则键盘用户点开一次就丢了按钮位置。
        onOpenAutoFocus={(event) => event.preventDefault()}
        // role="dialog" 由 Radix 的 PopoverContent 提供，不手写（写了会重复）
        aria-label={t("statusPopover.ringTooltip")}
        // p-3 必须留着：vendored 的 PopoverContent 自带 p-4，靠 cn() 的
        // 「调用方 className 在最后」压住。本文件另有一条用例断言面板带 p-3、不带 p-1。
        className="w-[340px] p-3 text-xs"
      >
        <div className="flex items-center gap-2">
          <span className="w-[60px] shrink-0 text-muted-foreground">
            {t("statusPopover.context")}
          </span>
          <AppProgress
            value={contextUsagePercentage}
            max={100}
            aria-label={t("statusPopover.context")}
            className="h-2 flex-1 rounded-sm bg-accent [&>div]:rounded-sm"
          />
          <span className="w-[38px] shrink-0 text-right font-medium tabular-nums text-foreground">
            {Math.round(contextUsagePercentage)}%
          </span>
        </div>
        <div className="pl-[70px] pt-0.5 text-[11px] tabular-nums text-muted-foreground">
          {contextStatusDetails.usedLabel} / {contextStatusDetails.totalLabel}
        </div>

        {quota.map((snapshot) =>
          snapshot.windows.length > 0 ? (
            <div
              key={snapshot.providerId}
              className="mt-2 border-t border-border/40 pt-2"
            >
              <div className="flex items-baseline gap-1.5 pb-1 text-[11px] font-semibold text-muted-foreground">
                <span>{snapshot.providerName}</span>
                {snapshot.planName && (
                  <span className="font-normal text-muted-foreground">
                    {snapshot.planName}
                  </span>
                )}
              </div>
              <div className="border-l-2 border-border/40 pl-2">
                {snapshot.windows.map((window) => (
                  <div key={window.kind}>
                    <div className="flex items-center gap-2">
                      <span className="w-[60px] shrink-0 text-muted-foreground">
                        {window.kind === "session"
                          ? t("statusPopover.windowSession")
                          : t("statusPopover.windowWeekly")}
                      </span>
                      <AppProgress
                        value={window.usedPercent}
                        max={100}
                        aria-label={
                          window.kind === "session"
                            ? t("statusPopover.windowSession")
                            : t("statusPopover.windowWeekly")
                        }
                        className="h-2 flex-1 rounded-sm bg-accent [&>div]:rounded-sm"
                      />
                      <span className="w-[38px] shrink-0 text-right font-medium tabular-nums text-foreground">
                        {Math.round(window.usedPercent)}%
                      </span>
                    </div>
                    {window.resetsAt !== undefined && (
                      <div className="pl-[70px] pt-0.5 text-[11px] tabular-nums text-muted-foreground">
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

        {(contextStatusDetails.cacheHitRate !== "--" ||
          contextStatusDetails.tokenSpeedLabel) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-1.5 border-t border-border/40 pt-2 text-[11px] tabular-nums text-muted-foreground">
            {contextStatusDetails.cacheHitRate !== "--" && (
              <span>
                {t("statusPopover.cacheHitRate", {
                  rate: contextStatusDetails.cacheHitRate,
                })}
              </span>
            )}
            {contextStatusDetails.cacheHitRate !== "--" &&
              contextStatusDetails.tokenSpeedLabel && (
                <span aria-hidden="true" className="opacity-45">
                  ·
                </span>
              )}
            {contextStatusDetails.tokenSpeedLabel && (
              <span className="font-medium text-foreground">
                {contextStatusDetails.tokenSpeedLabel}
              </span>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
