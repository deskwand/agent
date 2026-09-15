import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useBrowserOcclusion } from "../../hooks/useBrowserOcclusion";

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

  // 浏览器面板是原生视图，会画在 HTML 之上：打开期间必须注册遮挡，
  // 否则弹窗会被它盖住。卸载时 hook 自己释放。
  useBrowserOcclusion(true);

  // Esc 绑在 document 上而不是弹窗元素上（照 SkillMdModal 的写法）。
  // 原因：点遮罩后焦点会离开弹窗（落到 body），那时弹窗元素上的 keydown
  // 再也收不到事件，Esc 会失效——而弹窗声明了 aria-modal，用户会以为它还在。
  // 内容体里按「先清搜索、再关闭」的两段语义处理，并调用 stopPropagation；
  // 它所在的 portal 容器（body）比 document 先收到事件，所以不会双触发。
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-overlay animate-fade-in"
      onMouseDown={(event) => {
        // 点遮罩不关闭弹窗，但也不该把焦点从搜索框抢走：preventDefault 阻止
        // 默认的「焦点落到 body」，Esc 与继续打字才不会失去落点。
        if (event.target === event.currentTarget) event.preventDefault();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t(`attachMenu.${source}`)}
        className="mx-4 flex max-h-[88vh] w-full max-w-[720px] flex-col overflow-hidden rounded-6xl border border-border-subtle bg-background shadow-elevated animate-slide-up"
      >
        <div className="flex items-center gap-3 border-b border-border-muted px-6 py-[18px]">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-[0.14em] text-text-muted">
              {t("attachPicker.eyebrow")}
            </p>
            <h2 className="mt-0.5 text-sm font-semibold text-text-primary">
              {t(`attachMenu.${source}`)}
            </h2>
            <p className="mt-0.5 min-h-[18px] truncate text-[13px] text-text-secondary">
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={onClose}
            className="rounded-xl p-2 text-text-secondary transition-colors hover:bg-surface-hover"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {children}

        <div className="flex items-center gap-2.5 border-t border-border-muted px-6 py-3.5">
          <span className="flex-1 text-xs text-text-muted">
            {selectedCount === 0
              ? t("attachPicker.selectedNone")
              : t("attachPicker.selectedCount", { count: selectedCount })}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-xl border border-border px-4 text-sm text-text-primary transition-colors hover:bg-surface-hover"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={selectedCount === 0}
            onClick={onConfirm}
            className="h-9 rounded-xl bg-accent px-4 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:border disabled:border-border-muted disabled:bg-surface-muted disabled:text-text-muted"
          >
            {t("attachPicker.addCount", { count: selectedCount })}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
