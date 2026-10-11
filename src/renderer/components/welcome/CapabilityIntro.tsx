import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { buildCapabilityRows, CAPABILITIES } from "../../capabilities/catalog";
import { useCapabilityGate } from "../../hooks/useCapabilityGate";
import { useAppStore } from "../../store";
import { AppProgress } from "../app-progress";
import { Button } from "../app-button";

/**
 * 未配置首屏那一行「顺手装上本机能力」。
 *
 * 默认折叠：首屏的主指令是"先连接"，这块是**可选**的。任何一次交互
 * （展开 / 开启任一 / 不用了）都写 `capabilityIntro.dismissedAt`，此后不再出现 ——
 * 它只负责"告知一次"，不是催办。
 *
 * 视觉全部走 shadcn 语义 token（`bg-card` / `bg-muted` / `text-muted-foreground` /
 * `border-border/40`）与 `app-button` 的 Button 档位。2026-10-10 的 token 换代把
 * 旧 vocabulary 全判死了：写旧的类名不报错、只是渲染不出样式（守卫见
 * `src/tests/renderer/official-vocabulary.test.ts` 与 `class-compile.test.ts`）。
 */
export function CapabilityIntro(): JSX.Element | null {
  const { t } = useTranslation();
  const appConfig = useAppStore((s) => s.appConfig);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const gate = useCapabilityGate();
  const [expanded, setExpanded] = useState(false);
  /**
   * 「这次挂载之前看过没有」——**挂载时快照一次**，之后不再跟 store 走。
   *
   * 写 `dismissedAt` 是为了"下次启动不再出现"，不是"当场消失"：如果直接读
   * `appConfig`，用户点「看看」的那一下就会把整块从屏幕上抹掉（写入 → store 更新
   * → 守卫为真 → 返回 null）。那样展开态根本没人看得见。
   */
  const [dismissed, setDismissed] = useState(false);
  const seenOnMount = useRef<number | null | undefined>(undefined);
  if (appConfig && seenOnMount.current === undefined) {
    seenOnMount.current = appConfig.capabilityIntro?.dismissedAt ?? null;
  }

  // 首帧读一次真实安装态：否则三行会先按"没装"画一下（store 初值就是 null）。
  const refresh = gate.refresh;
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!appConfig) return null;
  if (seenOnMount.current != null) return null;
  // 用户点了「不用了」：当场收起（写盘只保证"下次不再出现"）。
  if (dismissed) return null;

  const rows = buildCapabilityRows(appConfig, gate.installs, {
    running: gate.running,
    positions: gate.positions,
  });

  /** 写「看过」标记。**不收起自己** —— 收起只发生在「不用了」与下次挂载。 */
  const persistSeen = async () => {
    const saved = await window.electronAPI?.config.save({
      capabilityIntro: { dismissedAt: Date.now() },
    });
    if (saved?.config) setAppConfig(saved.config);
  };

  const dismiss = () => {
    setDismissed(true);
    void persistSeen();
  };

  const expand = () => {
    setExpanded(true);
    // 展开也算"看过一次"：下次不再主动出现，但**这一次要留在屏幕上**。
    void persistSeen();
  };

  if (!expanded) {
    return (
      <div className="mt-3.5 flex w-full max-w-[660px] items-center gap-3 rounded-2xl border border-dashed border-border bg-muted px-3.5 py-2.5">
        <span className="flex-1 text-xs text-muted-foreground">
          <b className="font-medium text-foreground">
            {t("capabilityIntro.collapsedLead")}
          </b>
          {"："}
          {t("capabilityIntro.collapsedSizes")}
        </span>
        <Button variant="outline" size="sm" type="button" onClick={expand}>
          {t("capabilityIntro.expand")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          className="text-muted-foreground"
          onClick={() => void dismiss()}
        >
          {t("capabilityIntro.dismiss")}
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-3.5 w-full max-w-[660px] overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border/40 px-3.5 py-2.5 text-xs text-muted-foreground">
        <b className="font-medium text-foreground">
          {t("capabilityIntro.collapsedLead")}
        </b>
        <span className="flex-1">{t("capabilityIntro.collapsedSizes")}</span>
      </div>
      {CAPABILITIES.map((spec) => {
        const row = rows.find((item) => item.id === spec.id);
        if (!row) return null;
        return (
          <div
            key={spec.id}
            className="flex items-center gap-3 border-b border-border/40 px-3.5 py-3 last:border-b-0"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-foreground">
                {t(spec.titleKey)}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {t(spec.descKey)}
              </span>
            </span>
            <span className="flex flex-none items-center gap-2">
              {row.state === "ready" ? (
                <span className="text-xs text-success">
                  {t("capabilityIntro.state.ready")}
                </span>
              ) : row.state === "downloading" ? (
                <>
                  {/* 不手搓进度条：`AppProgress` 会把区间语义写回 aria（vendored 的
                      Progress 不转 value ⇒ 读屏拿不到 aria-valuenow）。尺寸靠 className
                      压住它默认的 `h-2 w-full`（cn 去重，调用方赢）。 */}
                  <AppProgress
                    value={row.percent}
                    max={100}
                    className="h-1 w-20 flex-none"
                  />
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {t("capabilityIntro.state.downloading", {
                      percent: row.percent,
                    })}
                  </span>
                </>
              ) : row.state === "queued" ? (
                <span className="text-xs text-muted-foreground">
                  {t("capabilityIntro.state.queued")}
                </span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  data-testid={`capability-enable-${spec.id}`}
                  onClick={() => void gate.startInstall(spec.id)}
                >
                  {row.state === "error"
                    ? t("capabilityIntro.state.retry")
                    : t("capabilityIntro.action.enable")}
                </Button>
              )}
            </span>
          </div>
        );
      })}
      <div className="flex justify-end border-t border-border/40 bg-muted px-3.5 py-2">
        <Button
          variant="ghost"
          size="sm"
          type="button"
          className="text-muted-foreground"
          onClick={() => void dismiss()}
        >
          {t("capabilityIntro.dismissAll")}
        </Button>
      </div>
    </div>
  );
}
