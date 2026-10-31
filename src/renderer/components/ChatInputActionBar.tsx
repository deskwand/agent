import { AttachMenu } from "./attach/AttachMenu";
import { VoiceMicButton, type VoiceMicButtonProps } from "./VoiceMicButton";
import type { ChatInputAttachedFile } from "./ChatInput";

/**
 * 输入卡内的左簇：附件 / 麦克风。
 *
 * 与 `ChatInputBottomBar` 的分工：这一簇是「写之前能做的事」，在编辑器**左边**；
 * 展开与发送在编辑器右边。两者都在卡内同一行。拆成两个组件不是因为想分层 —— 它们
 * 落在 flex 行的两端、中间夹着编辑器，一个组件没法把编辑区包在自己中间。
 *
 * 展开按钮不在这里：它按「有没有内容」出现，留在左簇会把麦克风与文字右推；它需要一个
 * 常驻的隐形槽位，所以归右簇（`ChatInputBottomBar`）。
 */
export interface ChatInputActionBarProps {
  onAttach: () => void;
  /** 当前会话工作目录，透传给 AttachMenu */
  cwd?: string;
  /** 选择器选出的附件 */
  onAddFiles: (files: ChatInputAttachedFile[]) => void;
  /** 已在输入框里的附件身份 key */
  attachedKeys: ReadonlySet<string>;
  /** 附件菜单展开方向；缺省向上（输入框贴底时） */
  attachMenuDirection?: "up" | "down";
  /** 附件菜单确认/取消后，请宿主把焦点交回输入框 */
  onAttachMenuDismiss?: () => void;
  /** 命令入口：原样透传给 AttachMenu；缺省 = 本宿主没有命令能力（欢迎页） */
  onCommandEntry?: (command: "compact" | "goal") => void;
  /** 自定义命令入口：宿主把 chip 插进输入框。缺省 = 本宿主不支持自定义命令 */
  onInsertPromptCommand?: (name: string) => void;
  /** 技能入口：宿主把 /skill:<name> 插进输入框。缺省 = 本宿主不支持技能引用 */
  onInsertSkill?: (name: string) => void;
  /**
   * 语音输入的全部状态与动作。必填：漏接线要变成编译错误，
   * 而不是静默不显示麦克风（与 hasInputContent 同一套约定）。
   */
  voice: VoiceMicButtonProps;
}

export function ChatInputActionBar({
  onAttach,
  cwd,
  onAddFiles,
  attachedKeys,
  attachMenuDirection,
  onAttachMenuDismiss,
  onCommandEntry,
  onInsertPromptCommand,
  onInsertSkill,
  voice,
}: ChatInputActionBarProps) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <AttachMenu
        cwd={cwd}
        onPickLocalFiles={onAttach}
        onAddFiles={onAddFiles}
        attachedKeys={attachedKeys}
        direction={attachMenuDirection}
        onDismiss={onAttachMenuDismiss}
        onCommandEntry={onCommandEntry}
        onInsertPromptCommand={onInsertPromptCommand}
        onInsertSkill={onInsertSkill}
      />

      <VoiceMicButton {...voice} />
    </div>
  );
}
