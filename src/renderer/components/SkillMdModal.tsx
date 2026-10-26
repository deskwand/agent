import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { X, Loader2 } from "lucide-react";
import { MessageMarkdown } from "./MessageMarkdown";
import { Button } from "./app-button";
import { OccludingDialog } from "./ui/occluding-dialog";
import {
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

interface SkillMdModalProps {
  isOpen: boolean;
  title: string;
  content: string | null;
  loading?: boolean;
  onClose: () => void;
  /**
   * 关闭时回不到原入口（入口已被移除）的兜底：父级把自己的根容器聚焦。
   * 只在本地返回目标失效时调用，不是关闭业务回调（见 constraints.md 回焦方案）。
   */
  onRestoreFocus?: () => void;
}

/**
 * 技能说明预览弹窗。
 *
 * 外壳由 shadcn Dialog 承担，occlusion 由 OccludingDialog 承担（迁移前是自建遮罩，
 * 没有 occlusion —— 浏览器面板打开时会被原生视图盖住）。内容 / loading / 空态三分支、
 * 关闭矩阵（外点允许、Escape 允许、X 允许，loading 不阻塞）与 max-height 滚动均保留。
 *
 * 迁移替换掉的两处手写逻辑：
 *   - `document.addEventListener("keydown")` 的 Escape 监听 —— 交给 Radix
 *   - 遮罩 onClick + `overlayRef` 的 target 判定 —— 交给 Radix 的 outside 判定
 *
 * 关闭键走 DialogClose + 本地化 aria-label（`common.close`）：vendored DialogContent
 * 内置的那个把可访问名硬编码成英文 "Close"，且不是它自己的关闭回调，
 * 所以用 `[&>button]:hidden` 藏掉内置键、自己画一个（ImageLightbox 同款模式）。
 * 不手改 vendored 文件、不给它加 prop。
 *
 * `aria-describedby={undefined}` 是刻意的：本弹窗没有说明文本，不拿标题冒充描述。
 * 真要加说明文本时用 DialogDescription。
 */
export function SkillMdModal({
  isOpen,
  title,
  content,
  loading,
  onClose,
  onRestoreFocus,
}: SkillMdModalProps) {
  const { t } = useTranslation();
  const returnFocusRef = useRef<HTMLElement | null>(null);

  return (
    <OccludingDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-w-2xl [&>button]:hidden"
        aria-describedby={undefined}
        onOpenAutoFocus={() => {
          const active = document.activeElement;
          returnFocusRef.current =
            active instanceof HTMLElement && active !== document.body
              ? active
              : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = returnFocusRef.current;
          if (target?.isConnected && !target.matches(":disabled")) {
            target.focus({ preventScroll: true });
            // 连接且非 disabled 仍可能不可聚焦（被 CSS / 原生行为挡住），
            // 落焦不成功才用父级 fallback —— 见 constraints.md 共享回焦契约。
            if (document.activeElement !== target) onRestoreFocus?.();
          } else onRestoreFocus?.();
        }}
      >
        <DialogHeader className="flex-row items-center justify-between space-y-0 px-5 py-3 text-left border-b border-border/60">
          <DialogTitle className="truncate pr-4 text-sm font-semibold text-foreground">
            {title}
          </DialogTitle>
          <div className="absolute right-4 top-4">
            <DialogClose asChild>
              <Button
                variant="ghost"
                type="button"
                aria-label={t("common.close")}
                className="p-1 rounded-md hover:bg-hover-surface transition-colors shrink-0 h-auto"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </Button>
            </DialogClose>
          </div>
        </DialogHeader>
        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {content ? (
            <MessageMarkdown normalizedText={content} />
          ) : loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-primary-text animate-spin" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              {t("skillMarket.noContent")}
            </p>
          )}
        </div>
      </DialogContent>
    </OccludingDialog>
  );
}
