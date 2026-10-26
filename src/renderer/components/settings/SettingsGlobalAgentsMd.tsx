import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../app-button";
import { Textarea } from "../ui/textarea";
import { ConfirmDialog } from "../ConfirmDialog";
import { GLOBAL_AGENTS_MD_TEMPLATE } from "./globalAgentsMdTemplate";
import { SettingsCard, SettingsSection } from "./shared";

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
    <SettingsSection
      title={t("agentsMd.title")}
      description={t("agentsMd.description")}
    >
      <SettingsCard>
        <div className="space-y-3 p-4">
          {/* 2026-10-09 相位 3 ✓：`Textarea` base 自带 min-h-[80px] rounded-md border-input
              bg-transparent px-3 py-2 shadow-sm —— 与本仓观感冲突的逐条覆盖回来 ✗✓（min-h-44 /
              rounded-lg / border-border/60 / bg-muted / p-3 / shadow-none）。 */}
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t("agentsMd.placeholder")}
            className="min-h-44 w-full resize-y rounded-lg border border-border/60 bg-muted p-3 font-mono text-sm text-foreground shadow-none"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {t("agentsMd.hint")}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                type="button"
                onClick={handleInsertTemplate}
                className="h-auto rounded-lg border-border bg-transparent px-3 py-1.5 text-sm font-normal text-foreground shadow-none hover:bg-hover-surface hover:text-foreground"
              >
                {t("agentsMd.insertTemplate")}
              </Button>
              <Button
                variant="default"
                type="button"
                onClick={() => {
                  void handleSave();
                }}
                disabled={isBusy || !loaded}
                className="h-auto rounded-lg px-4 py-1.5 text-sm shadow-none hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t("agentsMd.save")}
              </Button>
            </div>
          </div>
          {status && (
            <div className="rounded-lg border border-border/60 bg-muted px-4 py-3 text-sm text-muted-foreground">
              {status}
            </div>
          )}
        </div>
      </SettingsCard>
      <ConfirmDialog
        isOpen={confirmInsert}
        title={t("agentsMd.replaceConfirm")}
        confirmLabel={t("agentsMd.insertTemplate")}
        onConfirm={doInsert}
        onCancel={() => setConfirmInsert(false)}
      />
    </SettingsSection>
  );
}
