import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { GlobalNotice, GlobalNoticeAction } from "../store";
import { Button } from "./app-button";

interface Props {
  notice: GlobalNotice | null;
  onDismiss: () => void;
  onAction: (action: GlobalNoticeAction) => void;
}

const noticeToneClass: Record<
  GlobalNotice["type"],
  { border: string; text: string }
> = {
  info: { border: "border-border", text: "text-foreground" },
  warning: { border: "border-warning/50", text: "text-warning" },
  error: { border: "border-destructive/50", text: "text-destructive" },
  success: { border: "border-success/50", text: "text-success" },
};

export function GlobalNoticeToast({ notice, onDismiss, onAction }: Props) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = setTimeout(() => {
      onDismiss();
    }, 6000);
    return () => clearTimeout(timer);
  }, [notice, onDismiss]);

  if (!notice) {
    return null;
  }

  const tone = noticeToneClass[notice.type];
  const message = notice.messageKey
    ? t(notice.messageKey, notice.messageValues)
    : notice.message;
  const actionLabel =
    notice.actionLabel ||
    (notice.action === "open_api_settings" ? t("api.openSettingsAction") : "");
  const noticeAction = notice.action;

  return (
    <div
      key={notice.id}
      className="fixed top-4 right-4 left-4 sm:left-auto z-50 animate-toast-in-top"
    >
      <div
        className={`max-w-sm rounded-4xl border bg-background/95 shadow-elevated ${tone.border}`}
      >
        <div className="flex items-start gap-3 px-4 py-3">
          <div className={`flex-1 text-sm leading-relaxed ${tone.text}`}>
            {message}
          </div>
          <Button variant="ghost"
            type="button"
            onClick={onDismiss}
            className="text-muted-foreground hover:text-foreground transition-colors h-auto"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        {noticeAction && actionLabel && (
          <div className="px-4 pb-3">
            <Button variant="ghost"
              type="button"
              onClick={() => onAction(noticeAction)}
              className="w-full rounded-xl border border-primary/40 bg-primary/10 px-3 py-2.5 text-sm font-medium text-primary-text hover:bg-primary/20 transition-[transform,background-color,color] active:scale-[0.97] h-auto"
            >
              {actionLabel}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
