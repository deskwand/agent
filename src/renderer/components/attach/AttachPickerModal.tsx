import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { OccludingDialog } from "../ui/occluding-dialog";
import { DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { Button } from "../app-button";

export interface AttachPickerModalProps {
  source: "vault" | "workspace";
  /** 头部副行：文件数 · 工作区路径（加载中或扫描被截断时调用方省略文件数） */
  subtitle: string;
  /** 已选条目数，驱动底部计数与「添加」的禁用态 */
  selectedCount: number;
  onClose: () => void;
  onConfirm: () => void;
  children: ReactNode;
}

/**
 * 选择器弹窗外壳：遮罩、面板、header/footer、portal、浏览器遮挡注册。
 * 不感知数据源，也不持有选择状态——那两件事分别在 AttachMenu 与 AttachPickerPanel。
 *
 * 迁移后这些职责分别由 shadcn 的 Dialog（遮罩、面板、portal、Esc）与
 * OccludingDialog（浏览器遮挡）承担，本组件只留内容。
 *
 * **点外部不关闭弹窗**：原实现在遮罩的 onMouseDown 里 preventDefault，
 * 让焦点留在搜索框上（点遮罩不该把焦点抢走）。这个语义由下面的
 * `onInteractOutside` 抑制保住 —— 注意这是**我们自己的代码**，不是 Radix 默认
 *（Dialog 默认会关闭遮罩点击）。
 *
 * **Esc 的处理（两段式）**：原实现把监听绑在 document 上而不是弹窗元素上，注释写明了原因：
 * 点遮罩后焦点会离开弹窗（落到 body），绑在元素上的 keydown 再也收不到事件，
 * 而弹窗声明了 aria-modal、用户会以为它还在。那个踩坑的结论仍然成立，只是不必
 * 再手写监听 —— 但**不能**直接交给 Radix 了事：
 *
 * Radix 的 Esc 监听挂在 document 的**捕获阶段**，会先于弹窗内任何 React 处理器
 * 跑完并关掉弹窗。面板里那套「第一次 Esc 只清搜索词、第二次才关」的两段语义
 * 会被吃掉 —— 用户筛着文件按一下 Esc，整个选择器就没了。
 * 所以这里用 `onEscapeKeyDown` 一律阻止 Radix 自己的关闭，改由下面的 `onKeyDown`
 * 按同一套 React 冒泡顺序处理：焦点在面板里时面板的处理器先跑并 `stopPropagation()`
 *（它只管自己的两段语义），焦点在页脚按钮上时则由这里兜底关闭。
 *
 * **关闭键只有一个**：原实现自带一个（带 i18n 的 aria-label），而 DialogContent
 * 也内置一个 —— 两个都留会在同一角落叠出两个 X。与 ConfigModal 的先例一致，
 * 删掉组件自己那个、用内置的。
 *
 * 用 Dialog 而不是 AlertDialog：picker 不是「必须应答」的紧急场景，
 * AlertDialogContent 会渲染 role="alertdialog"，读屏会按紧急角色播报一个文件选择器。
 */
export function AttachPickerModal({
  source,
  subtitle,
  selectedCount,
  onClose,
  onConfirm,
  children,
}: AttachPickerModalProps) {
  const { t } = useTranslation();

  return (
    <OccludingDialog
      open
      onOpenChange={(next) => {
        // 只有 Esc 会走到这里（外部点击已被下面的 onInteractOutside 抑制）。
        if (!next) onClose();
      }}
    >
      <DialogContent
        aria-label={t(`attachMenu.${source}`)}
        className="mx-4 flex max-h-[88vh] w-full max-w-[720px] flex-col gap-0 overflow-hidden p-0"
        onInteractOutside={(event) => {
          // 保住原实现的语义：点遮罩不关闭弹窗，也不该把焦点从搜索框抢走。
          // 原实现是在遮罩的 onMouseDown 里 preventDefault 达到同样效果。
          event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          // 一律不让 Radix 自己关 —— 它监听在 document 的捕获阶段，会抢在
          // 面板的两段式 Esc 之前把弹窗关掉（详见组件文档）。关闭改由下面的
          // onKeyDown 按 React 的冒泡顺序决定。
          event.preventDefault();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <div className="flex items-center gap-3 border-b border-border-muted px-6 py-[18px]">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-[0.14em] text-text-muted">
              {t("attachPicker.eyebrow")}
            </p>
            <DialogTitle className="mt-0.5 text-sm font-semibold text-text-primary">
              {t(`attachMenu.${source}`)}
            </DialogTitle>
            <DialogDescription className="mt-0.5 min-h-[18px] truncate text-[13px] text-text-secondary">
              {subtitle}
            </DialogDescription>
          </div>
        </div>

        {children}

        <div className="flex items-center gap-2.5 border-t border-border-muted px-6 py-3.5">
          <span className="flex-1 text-xs text-text-muted">
            {selectedCount === 0
              ? t("attachPicker.selectedNone")
              : t("attachPicker.selectedCount", { count: selectedCount })}
          </span>
          <Button variant="ghost"
            type="button"
            onClick={onClose}
            className="h-9 rounded-xl border border-border px-4 text-sm text-text-primary transition-colors hover:bg-surface-hover"
          >
            {t("common.cancel")}
          </Button>
          <Button variant="ghost"
            type="button"
            disabled={selectedCount === 0}
            onClick={onConfirm}
            className="h-9 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:border disabled:border-border-muted disabled:bg-surface-muted disabled:text-text-muted"
          >
            {t("attachPicker.addCount", { count: selectedCount })}
          </Button>
        </div>
      </DialogContent>
    </OccludingDialog>
  );
}
