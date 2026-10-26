import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { buildArtifactItems } from "../utils/artifact-steps";
import { Layers, Loader2 } from "lucide-react";
import { getFileKind } from "../utils/file-types";
import { FileTypeIcon } from "./file-type-icon";
import { OpenWithSystemAppButton } from "./OpenWithSystemAppButton";
import { useOpenArtifact } from "../hooks/use-open-artifact";
import type { TraceStep } from "../types";

const EMPTY_STEPS: TraceStep[] = [];

export function ArtifactPanel() {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const sessionStates = useAppStore((s) => s.sessionStates);
  const workingDir = useAppStore((s) => s.workingDir);
  const officePreviewBusyPath = useAppStore((s) => s.officePreviewBusyPath);
  const { openArtifact, canOpenPath } = useOpenArtifact();

  const ss = activeSessionId ? sessionStates[activeSessionId] : undefined;
  const steps = ss?.traceSteps ?? EMPTY_STEPS;
  const activeSession = activeSessionId
    ? sessions.find((s) => s.id === activeSessionId)
    : null;
  const currentWorkingDir = activeSession?.cwd || workingDir;

  const displayArtifacts = useMemo(
    () => buildArtifactItems(steps, currentWorkingDir),
    [currentWorkingDir, steps],
  );

  return (
    <>
      <div
        className="
        absolute top-3 right-3 z-50
        w-[360px] max-h-[55vh]
        bg-background
        border border-border/40 rounded-2xl shadow-2xl
        flex flex-col overflow-hidden
      "
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 shrink-0">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">
              {t("artifactPanel.title", "产物")}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 py-1">
          {displayArtifacts.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-4 text-xs text-muted-foreground">
              <Layers className="w-3.5 h-3.5 shrink-0" />
              <span>{t("context.noArtifactsYet", "尚无产物")}</span>
            </div>
          ) : (
            displayArtifacts.map((artifact, index) => {
              const label =
                artifact.label || t("context.fileCreated", "文件已创建");
              const artifactPath = artifact.path;
              const canClick = Boolean(artifactPath && canOpenPath);

              return (
                <div
                  key={artifact.path || artifact.label || `artifact-${index}`}
                  className={`group flex items-center gap-2.5 px-4 py-2 transition-colors ${
                    canClick ? "hover:bg-accent" : ""
                  }`}
                  onClick={() => {
                    if (!canClick) return;
                    void openArtifact(artifactPath, label);
                  }}
                  title={artifactPath || undefined}
                >
                  <FileTypeIcon kind={getFileKind(artifactPath)} size={16} />
                  <span className="selectable text-sm text-foreground truncate flex-1">
                    {label}
                  </span>
                  {artifactPath && (
                    <span className="flex w-5 shrink-0 items-center justify-center">
                      {officePreviewBusyPath === artifactPath ? (
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin text-primary-text"
                          data-testid="office-preview-busy"
                        />
                      ) : (
                        <span className="opacity-0 group-hover:opacity-100">
                          <OpenWithSystemAppButton filePath={artifactPath} />
                        </span>
                      )}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
