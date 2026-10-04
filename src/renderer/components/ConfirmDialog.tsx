import { useTranslation } from "react-i18next";
import { useBrowserOcclusion } from "../hooks/useBrowserOcclusion";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  confirmLabel?: string;
  /**
   * 确认键的语气。默认 `danger`：这个原语最早只服务「删除」，
   * 既有调用点不该因为新用法换样子。
   */
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  confirmLabel,
  tone = "danger",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  useBrowserOcclusion(isOpen);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-overlay animate-fade-in">
      <div className="card w-full max-w-sm p-5 m-4 shadow-elevated animate-slide-up">
        <p className="text-sm text-text-primary">{title}</p>
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-surface-hover transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tone === "primary"
                ? "bg-accent/10 text-accent hover:bg-accent/20"
                : "bg-error/10 text-error hover:bg-error/20"
            }`}
          >
            {confirmLabel ?? t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}
