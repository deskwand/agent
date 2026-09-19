import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { useBrowserOcclusion } from "../hooks/useBrowserOcclusion";
import { MessageMarkdown } from "./MessageMarkdown";
import { pickReleaseNotes } from "../utils/release-notes";

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

export function UpdateConfirmDialog({
  isOpen,
  currentVersion,
  newVersion,
  releaseNotes,
  onConfirm,
  onCancel,
}: UpdateConfirmDialogProps) {
  const { t, i18n } = useTranslation();
  useBrowserOcclusion(isOpen);

  if (!isOpen) return null;

  const notes = pickReleaseNotes(releaseNotes, i18n.language);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-overlay px-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border-muted bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Icon */}
        <div className="flex justify-center pt-7 pb-3">
          <div className="w-14 h-14 rounded-full bg-accent-muted flex items-center justify-center">
            <RefreshCw className="w-6 h-6 text-accent" />
          </div>
        </div>

        {/* Text */}
        <div className="text-center px-6 pb-2 space-y-1.5">
          <h3 className="text-base font-semibold text-text-primary">
            {t("update.title")}
          </h3>
          <p className="text-sm text-text-muted leading-relaxed">
            {t("update.description", { version: newVersion })}
          </p>
          {currentVersion && (
            <div className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-md bg-surface-muted text-xs text-text-secondary">
              <span>{currentVersion}</span>
              <span className="text-accent">→</span>
              <span className="text-accent font-semibold">{newVersion}</span>
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
        <div className="flex items-center gap-2 border-t border-border-muted px-5 py-4 mt-4">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl px-4 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors"
          >
            {t("update.later")}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground hover:bg-accent/90 transition-colors"
          >
            {t("update.restart")}
          </button>
        </div>
      </div>
    </div>
  );
}
