import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Folder } from "lucide-react";
import type { ProviderProfileKey, ThinkingLevel } from "../types";
import {
  type ContextStatusDetails,
  type ModelOptionGroup,
} from "./ChatInputBottomBar";
import { MergedInputChip } from "./MergedInputChip";
import { StatusPopover } from "./StatusPopover";

/**
 * 输入卡外面的页脚栏：只放「长期状态」，不放提交动作。
 *
 * 两簇的槽位是固定的 —— 左 = 在哪干活（目录 / 项目），右 = 用什么跑
 * （模型 / 思考强度 / 上下文）。以后加状态项请追加在本簇末尾，不要插到中间：
 * 位置一旦会漂，「第几颗是模型」这类肌肉记忆就失效了。
 *
 * 与卡内 ChatInputBottomBar 的分工：
 *   - 卡内 = 这一次输入的动作（附件 / 展开 / 麦克风 / 发送）
 *   - 卡外 = 跨多次输入的设定（模型 / 上下文 / 目录）
 * 视觉上分开的理由见 design-docs/2026-10-30-input-footer-before-after.html。
 */
export interface ChatInputFooterBarProps {
  /** 左簇内容：目录 chip / 项目菜单。缺省时左簇为空但占位（右簇仍贴右）。 */
  leftSlot?: ReactNode;
  model: string;
  modelOptions: ModelOptionGroup[];
  activeProviderProfileKey: ProviderProfileKey;
  onSelectModel: (profileKey: ProviderProfileKey, modelId: string) => void;
  modelMenuDisabled?: boolean;
  thinkingLevel: ThinkingLevel;
  thinkingLevelOptions: ThinkingLevel[];
  onSelectThinkingLevel: (level: ThinkingLevel) => void;
  contextUsagePercentage: number;
  contextRingColorClass: string;
  contextStatusDetails: ContextStatusDetails;
}

export function ChatInputFooterBar({
  leftSlot,
  model,
  modelOptions,
  activeProviderProfileKey,
  onSelectModel,
  modelMenuDisabled = false,
  thinkingLevel,
  thinkingLevelOptions,
  onSelectThinkingLevel,
  contextUsagePercentage,
  contextRingColorClass,
  contextStatusDetails,
}: ChatInputFooterBarProps) {
  return (
    <div className="mt-2 flex min-w-0 items-center justify-between gap-2 px-1">
      <div className="flex min-w-0 max-w-[35%] shrink items-center gap-1.5">
        {leftSlot}
      </div>
      <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 [&>div]:min-w-0 [&>div]:max-w-full [&>span]:shrink-0">
        <MergedInputChip
          model={model}
          modelOptions={modelOptions}
          activeProviderProfileKey={activeProviderProfileKey}
          onSelectModel={onSelectModel}
          modelMenuDisabled={modelMenuDisabled}
          thinkingLevel={thinkingLevel}
          thinkingLevelOptions={thinkingLevelOptions}
          onSelectThinkingLevel={onSelectThinkingLevel}
        />
        <StatusPopover
          contextUsagePercentage={contextUsagePercentage}
          contextRingColorClass={contextRingColorClass}
          contextStatusDetails={contextStatusDetails}
        />
      </div>
    </div>
  );
}

/**
 * 只读目录 chip。
 *
 * 为什么不做成下拉：会话的工作目录在会话建立后由主进程与会话绑定，改目录要新建
 * 会话才成立；给一枚看起来能改的胶囊只会制造假入口。欢迎页那个
 * `ProjectMenuChip` 是入口（还没绑会话），这里是事实。
 */
export function WorkspaceChip({ cwd }: { cwd: string | null }) {
  const { t } = useTranslation();
  if (!cwd) return null;
  const name = cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;
  return (
    <span
      title={cwd}
      aria-label={t("chat.workspaceChip", { path: cwd })}
      className="inline-flex min-w-0 max-w-[16rem] items-center gap-1 rounded-full border border-border/40 px-2 py-0.5 text-[11px] text-muted-foreground"
    >
      <Folder aria-hidden="true" className="h-3 w-3 flex-shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  );
}
