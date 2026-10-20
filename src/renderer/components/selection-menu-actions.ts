/**
 * @module renderer/components/selection-menu-actions
 *
 * 划词菜单的动作表。**数组顺序就是菜单里从左到右的顺序**（与设计文档 §7 的表、
 * 形态对照图一致：朗读在前，复制在末）。
 * 新增一项 = 往这里加一个对象 + 两条 i18n（zh/en）。
 *
 * 文案 key 是动态的（`t(action.labelKey)`），`renderer-i18n-keys.test.ts` 的静态
 * 正则抓不到 —— 所以 `selection-menu.test.ts` 里有一条穷举断言替它兜底。
 */
import { Copy, Lightbulb, Quote, Volume2 } from "lucide-react";
import type { SelectionAction } from "../utils/selection-menu";
import {
  isSpeaking,
  selectionSpeechController,
  stopSelectionSpeech,
} from "../utils/tts/selection-speech";
import { useAppStore } from "../store";

export const SELECTION_ACTIONS: SelectionAction[] = [
  {
    id: "read-aloud",
    labelKey: "selectionMenu.readAloud",
    icon: Volume2,
    // 播放中这一项就是唯一的停止入口，所以此时不能重读。
    // 判据用 runtime.speaking（preparing | playing），error 不算 —— 失败后应该能重试。
    labelKeyWhen: (_ctx, runtime) =>
      runtime.speaking ? "selectionMenu.stopReading" : undefined,
    // 语音会话在跑时置灰：与消息朗读同一道门（文案复用 messageCard.readAloudBusy）。
    enabledWhen: (_ctx, runtime) => !runtime.voiceModeOpen,
    run: (ctx) => {
      // 这里读实时值：菜单可能是几十毫秒前渲染的，而音频刚播完。
      if (isSpeaking(useAppStore.getState().selectionSpeech.status)) {
        stopSelectionSpeech(); // 只停，不重读
        return;
      }
      selectionSpeechController().start(ctx.text);
    },
  },
  {
    id: "save-idea",
    labelKey: "selectionMenu.saveIdea",
    icon: Lightbulb,
    // 用原样文本：想法多半是代码或带换行的片段，折叠了就看不出结构。
    // 不截断 —— 截断会静默丢尾巴；超长交给浮层既有的提示与保存门禁。
    run: (ctx) => {
      useAppStore.getState().openIdeaCapture(ctx.rawText);
    },
  },
  {
    id: "quote",
    labelKey: "selectionMenu.quote",
    icon: Quote,
    run: (ctx) => {
      // 只填不自动发：与灵感页「交给 AI」同规则，你多半还要补一句问法。
      // 也不切视图 —— 正在订阅页读文章时不该被踢到聊天页。
      useAppStore.getState().setPendingEditorAppend(ctx.rawText);
      useAppStore.getState().setGlobalNotice({
        id: "selection-quoted",
        type: "success",
        message: "",
        messageKey: "selectionMenu.quoted",
      });
    },
  },
  {
    id: "copy",
    labelKey: "selectionMenu.copy",
    icon: Copy,
    visibleInDialog: true,
    run: (ctx) => {
      // 与 CodeBlock.tsx / MessageCard.tsx 同形：失败静默（菜单已收起，
      // 没有可承载提示的地方）。
      void navigator.clipboard.writeText(ctx.rawText);
    },
  },
];
