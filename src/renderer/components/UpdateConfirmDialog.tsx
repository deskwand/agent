import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { MessageMarkdown } from "./MessageMarkdown";
import { pickReleaseNotes } from "../utils/release-notes";
import { OccludingDialog } from "./ui/occluding-dialog";
import { DialogContent, DialogTitle } from "./ui/dialog";
import { Button } from "./app-button";

// Notes are plain prose. rehype-sanitize's default schema allows remote images,
// which would turn opening the dialog into a request to whoever wrote the URL —
// and a broken-image icon when it is blocked.
const MARKDOWN_COMPONENTS = { img: () => null };

interface UpdateConfirmDialogProps {
  isOpen: boolean;
  currentVersion: string;
  newVersion: string;
  releaseNotes?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 更新确认框。
 *
 * 外壳与「点击遮罩关闭」由 shadcn Dialog 承担（原先手写 onClick + stopPropagation，
 * Radix 走 onInteractOutside → onOpenChange(false) → onCancel，语义一致）；
 * occlusion 由 OccludingDialog 承担。
 *
 * 内容、i18n key 与 release notes 的安全处理（屏蔽 img）均未改 —— 后者是安全决定，
 * 不是样式决定。
 *
 * `isOpen` 仍是父级受控（与原实现一致）。迁移后 DialogContent 会带上一个内置的
 * 右上角关闭键（原实现没有），这是 D2「以 shadcn 默认观感为准」的直接结果。
 */
export function UpdateConfirmDialog({
  isOpen,
  currentVersion,
  newVersion,
  releaseNotes,
  onConfirm,
  onCancel,
}: UpdateConfirmDialogProps) {
  const { t, i18n } = useTranslation();
  // 只在开着的时候解析 notes。
  //
  // 原实现在这一行之前有 `if (!isOpen) return null;`，所以关着时不会碰到
  // i18n 实例；迁到 Radix 后早退被去掉（开合交给 open prop 管），这行就变成无条件求值了。
  // 后果不是「多算一次」—— 而是**在弹窗关闭时读 i18n 实例**：多个既有测试
  // （app-rail-click-routing / feed-rail / voice-rail-icon / help-menu）把
  // react-i18next mock 成只提供 `t`，`i18n` 为 undefined，于是整棵渲染树崩掉。
  // 这些 mock 本身不完整（真实 useTranslation 总会返回 i18n），但保持惰性
  // 既恢复了原控制流、又省掉一次无用计算，比去改一堆测试的 mock 更对症。
  const notes = isOpen ? pickReleaseNotes(releaseNotes, i18n.language) : null;

  return (
    <OccludingDialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="max-w-sm gap-0 p-0">
        {/* Icon */}
        <div className="flex justify-center pt-7 pb-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-muted">
            <RefreshCw className="h-6 w-6 text-primary" />
          </div>
        </div>

        {/* Text */}
        <div className="space-y-1.5 px-6 pb-2 text-center">
          <DialogTitle className="text-base font-semibold text-text-primary">
            {t("update.title")}
          </DialogTitle>
          <p className="text-sm leading-relaxed text-text-muted">
            {t("update.description", { version: newVersion })}
          </p>
          {currentVersion && (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-surface-muted px-2.5 py-1 text-xs text-text-secondary">
              <span>v{currentVersion}</span>
              <span className="text-primary">→</span>
              <span className="font-semibold text-primary">v{newVersion}</span>
            </div>
          )}
        </div>

        {/* Release notes — omitted entirely when the manifest has none */}
        {notes && (
          <div
            role="region"
            aria-label={t("update.notesLabel")}
            tabIndex={0}
            className="mt-4 max-h-[40vh] overflow-y-auto border-t border-border-muted px-5 pt-3.5 pb-1"
          >
            <MessageMarkdown
              normalizedText={notes}
              components={MARKDOWN_COMPONENTS}
            />
          </div>
        )}

        {/* Actions */}
        <div className="mt-4 flex items-center gap-2 border-t border-border-muted px-5 py-4">
          <Button variant="ghost"
            onClick={onCancel}
            className="flex-1 rounded-xl px-4 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-hover h-auto"
          >
            {t("update.later")}
          </Button>
          <Button variant="ghost"
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 h-auto"
          >
            {t("update.restart")}
          </Button>
        </div>
      </DialogContent>
    </OccludingDialog>
  );
}
