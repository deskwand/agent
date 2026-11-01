import type { ReactNode } from "react";
import type { ProviderProfileKey, ThinkingLevel } from "../types";
import {
  type ContextStatusDetails,
  type ModelOptionGroup,
} from "./ChatInputBottomBar";
import { MergedInputChip } from "./MergedInputChip";
import { StatusPopover } from "./StatusPopover";

/** 输入卡外的运行设置：模型、思考强度、上下文；项目目录由会话标题展示。 */
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

export { WorkspaceChip } from "./WorkspaceChip";
