// 子代理实时步骤列表 —— 供 Agent 工具卡片的展开区使用（前台阻塞型与后台 spawn 卡片同一套）。
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type {
  SubagentActivity,
  SubagentStep,
} from "../../../shared/subagent-activity";
import { getToolLabel } from "./toolHelpers";
import { compactNumber } from "../../utils/usage-format";
import { modelDisplay } from "../../utils/subagent-model-display";
import { useAppStore } from "../../store";

interface SubagentStepsProps {
  activity: SubagentActivity;
}

type Translate = ReturnType<typeof useTranslation>["t"];

function stepLine(step: SubagentStep, t: Translate): string {
  return getToolLabel(step.toolName, step.args, t);
}

function durationText(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export const SubagentSteps = memo(function SubagentSteps({
  activity,
}: SubagentStepsProps) {
  const { t } = useTranslation();
  // provider 显示名要经 modelDisplay 实时本地化（与设置页同一套），所以得拿 provider 配置。
  // 注意：selector 必须返回稳定引用（`?? {}` 放进选择器会导致每帧新对象 → 无限重渲染）。
  const providers = useAppStore((s) => s.appConfig?.providers) ?? {};
  const parts: string[] = [
    t("subagent.statSteps", { count: activity.stats.toolUses }),
  ];
  if (activity.stats.turnCount) {
    parts.push(
      activity.stats.maxTurns
        ? t("subagent.statTurns", {
            turns: activity.stats.turnCount,
            max: activity.stats.maxTurns,
          })
        : t("subagent.statTurnsNoMax", { turns: activity.stats.turnCount }),
    );
  }
  if (activity.stats.tokens) {
    parts.push(
      t("subagent.statTokens", {
        tokens: compactNumber(activity.stats.tokens),
      }),
    );
  }
  parts.push(durationText(activity.stats.durationMs));
  // 模型名与 provider 名交给既有展示层：有 `provider/id` 就走 modelDisplay，否则用短名。
  const modelLabel = activity.model?.id
    ? modelDisplay(activity.model.id, providers, t)
    : activity.model?.name;
  if (modelLabel) parts.push(modelLabel);
  if (activity.model?.thinking && activity.model.thinking !== "off") {
    parts.push(t("subagent.statThinking", { level: activity.model.thinking }));
  }

  return (
    <div className="px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-text-muted">
        <Loader2
          className={`w-3 h-3 ${activity.status === "running" ? "animate-spin text-accent" : ""}`}
        />
        {t("subagent.stepsTitle")}
        {activity.background && activity.status === "running" && (
          <span className="normal-case text-accent">
            · {t("subagent.stepsBackground")}
          </span>
        )}
        {activity.name && (
          <span className="normal-case font-mono text-text-muted">
            @{activity.name}
          </span>
        )}
      </div>
      {activity.current && (
        <div className="text-xs font-mono text-accent">
          ◐ {stepLine(activity.current, t)}
        </div>
      )}
      <div className="mt-1 space-y-0.5">
        {activity.steps
          .filter((step) => step.id !== activity.current?.id)
          .map((step) => (
            <div
              key={step.id}
              className="flex items-center gap-1 text-xs font-mono text-text-secondary"
            >
              {step.isError ? (
                <XCircle className="w-3 h-3 flex-shrink-0 text-error" />
              ) : (
                <CheckCircle2 className="w-3 h-3 flex-shrink-0 text-text-muted" />
              )}
              <span className="min-w-0 truncate">{stepLine(step, t)}</span>
              <span className="flex-shrink-0 text-text-muted">
                {step.isError
                  ? `· ${t("subagent.stepFailed")}`
                  : step.durationMs != null
                    ? `· ${durationText(step.durationMs)}`
                    : ""}
              </span>
            </div>
          ))}
      </div>
      <div className="mt-2 border-t pt-2 text-xs text-text-muted">
        {parts.join(" · ")}
      </div>
    </div>
  );
});
