import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { X, Loader2 } from "lucide-react";
import { MessageMarkdown } from "./MessageMarkdown";

interface SkillMdModalProps {
  isOpen: boolean;
  title: string;
  content: string | null;
  loading?: boolean;
  onClose: () => void;
}

export function SkillMdModal({ isOpen, title, content, loading, onClose }: SkillMdModalProps) {
  const { t } = useTranslation();
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[10vh] pb-8 px-4 overflow-y-auto"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="w-full max-w-2xl rounded-xl border border-border bg-surface shadow-elevated animate-slide-up">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-text-primary truncate pr-4">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-surface-hover transition-colors shrink-0"
          >
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>
        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {content ? (
            <MessageMarkdown normalizedText={content} />
          ) : loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-accent animate-spin" />
            </div>
          ) : (
            <p className="text-sm text-text-muted text-center py-8">
              {t("skillMarket.noContent")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
