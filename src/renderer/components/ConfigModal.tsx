import { X, Key } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AppConfig } from "../types";
import { SettingsAPI } from "./settings/SettingsAPI";

interface ConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: Partial<AppConfig>) => Promise<void>;
  initialConfig?: AppConfig | null;
  isFirstRun?: boolean;
}

export function ConfigModal({ isOpen, onClose, isFirstRun }: ConfigModalProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md">
      <div className="mx-4 flex max-h-[88vh] w-full max-w-[960px] flex-col overflow-hidden rounded-[2rem] border border-border-subtle bg-background shadow-elevated">
        <div className="flex items-center justify-between border-b border-border-muted bg-background/88 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border-subtle bg-background-secondary/88 text-accent">
              <Key className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-text-muted">
                {t("settings.title")}
              </p>
              <h2 className="mt-1 text-sm font-semibold tracking-[-0.02em] text-text-primary">
                {isFirstRun ? t("api.firstRunTitle") : t("api.settingsTitle")}
              </h2>
              <p className="text-sm text-text-secondary">
                {isFirstRun
                  ? t("api.firstRunSubtitle")
                  : t("api.settingsSubtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 transition-colors hover:bg-surface-hover"
          >
            <X className="h-5 w-5 text-text-secondary" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-background/70 p-6">
          <SettingsAPI embedded onSaved={onClose} />
        </div>
      </div>
    </div>
  );
}
