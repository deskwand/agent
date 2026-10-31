import { AttachMenu } from "./attach/AttachMenu";
import type { ChatInputAttachedFile } from "./ChatInput";

/**
 * 输入卡内的左簇：仅附件（`+`）。
 *
 * 与 `ChatInputBottomBar` 的分工：这一簇是「写之前能做的事」，在编辑器**左边**；
 * 展开 / 麦克风 / 发送在编辑器右边。两者都在卡内同一行，由 `ChatInput` 的那条
 * flex 行排布 —— 拆成两个组件不是因为想分层，而是它们落在 flex 行的两端、
 * 中间夹着编辑器，一个组件没法把编辑区包在自己中间。
 *
 * 麦克风曾经在这里，已移到右簇：它是「用另一种方式产出内容」，与提交同属动作，
 * 而不是写之前的前置动作；且它占 36px，留在最左等于让每一行草稿都先缩进 38px。
 *
 * 展开按钮也不在这里：它按「有没有内容」出现，需要一个常驻的隐形槽位，
 * 所以归右簇（`ChatInputBottomBar`）。
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
    </div>
  );
}
