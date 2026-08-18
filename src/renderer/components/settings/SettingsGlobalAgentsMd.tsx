import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "../ConfirmDialog";
import { GLOBAL_AGENTS_MD_TEMPLATE } from "./globalAgentsMdTemplate";
import { SettingsContentSection } from "./shared";

export function SettingsGlobalAgentsMd() {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmInsert, setConfirmInsert] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.globalAgentsMd
      .read()
      .then((r) => {
        if (!cancelled) {
          setContent(r.content);
          setLoaded(true);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus(
            `${t("agentsMd.loadFailed")}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInsertTemplate = () => {
    if (content.trim()) {
      setConfirmInsert(true);
    } else {
      setContent(GLOBAL_AGENTS_MD_TEMPLATE);
    }
  };

  const doInsert = () => {
    setConfirmInsert(false);
    setContent(GLOBAL_AGENTS_MD_TEMPLATE);
  };

  const handleSave = async () => {
    setIsBusy(true);
    setStatus(null);
    try {
      const r = await window.electronAPI.globalAgentsMd.write(content);
      setStatus(
        r.ok
          ? t("agentsMd.saved")
          : `${t("agentsMd.saveFailed")}${r.error ? `: ${r.error}` : ""}`,
      );
    } catch (error) {
      setStatus(
        `${t("agentsMd.saveFailed")}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <SettingsContentSection
      title={t("agentsMd.title")}
      description={t("agentsMd.description")}
    >
      <div className="space-y-3">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={t("agentsMd.placeholder")}
          className="min-h-44 w-full resize-y rounded-lg border border-border-muted bg-background-secondary p-3 font-mono text-sm text-text-primary"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-text-muted">{t("agentsMd.hint")}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleInsertTemplate}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-surface-hover"
            >
              {t("agentsMd.insertTemplate")}
            </button>
            <button
              onClick={() => {
                void handleSave();
              }}
              disabled={isBusy || !loaded}
              className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t("agentsMd.save")}
            </button>
          </div>
        </div>
        {status && (
          <div className="rounded-lg border border-border-muted bg-background-secondary px-4 py-3 text-sm text-text-secondary">
            {status}
          </div>
        )}
      </div>
      <ConfirmDialog
        isOpen={confirmInsert}
        title={t("agentsMd.replaceConfirm")}
        confirmLabel={t("agentsMd.insertTemplate")}
        onConfirm={doInsert}
        onCancel={() => setConfirmInsert(false)}
      />
    </SettingsContentSection>
  );
}
