import { useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { resolveArtifactPath } from "../utils/artifact-path";
import {
  extractFilePathFromToolInput,
  extractFilePathFromToolOutput,
} from "../utils/tool-output-path";
import { getArtifactLabel, getArtifactSteps } from "../utils/artifact-steps";
import { File, FileCode, Image, Layers } from "lucide-react";
import { FilePreviewModal } from "./FilePreviewModal";
import { IMAGE_EXTS, CODE_LIKE_EXTS } from "../utils/file-types";
import { isPreviewableExt } from "../utils/file-preview";
import type { TraceStep } from "../types";

const EMPTY_STEPS: TraceStep[] = [];

function getFileIcon(ext: string) {
  if (IMAGE_EXTS.has(ext))
    return <Image className="w-4 h-4 shrink-0 text-sky-400" />;
  if (CODE_LIKE_EXTS.has(ext))
    return <FileCode className="w-4 h-4 shrink-0 text-accent" />;
  return <File className="w-4 h-4 shrink-0 text-text-muted" />;
}

export function ArtifactPanel() {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const sessionStates = useAppStore((s) => s.sessionStates);
  const workingDir = useAppStore((s) => s.workingDir);
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);

  const [previewFile, setPreviewFile] = useState<{
    path: string;
    name: string;
  } | null>(null);

  const ss = activeSessionId ? sessionStates[activeSessionId] : undefined;
  const steps = ss?.traceSteps ?? EMPTY_STEPS;
  const activeSession = activeSessionId
    ? sessions.find((s) => s.id === activeSessionId)
    : null;
  const currentWorkingDir = activeSession?.cwd || workingDir;
  const { displayArtifactSteps } = getArtifactSteps(steps);
  const canOpenPath =
    typeof window !== "undefined" && !!window.electronAPI?.openPath;

  const handleClick = useCallback(
    async (artifactPath: string, label: string) => {
      const dotIdx = artifactPath.lastIndexOf(".");
      const ext = dotIdx > 0 ? artifactPath.slice(dotIdx).toLowerCase() : "";
      if (isPreviewableExt(ext)) {
        setPreviewFile({ path: artifactPath, name: label });
      } else if (canOpenPath) {
        const result = await window.electronAPI.openPath(artifactPath);
        if (result.error) {
          setGlobalNotice({
            id: `artifact-open-failed-${Date.now()}`,
            type: "warning",
            message: t("context.openFailed", { error: result.error }),
          });
        }
      }
    },
    [canOpenPath, setGlobalNotice, t],
  );

  const displayArtifacts = useMemo(() => {
    const seenPaths = new Set<string>();
    const items: Array<{ label: string; path: string }> = [];

    for (const step of displayArtifactSteps) {
      const fallbackPath =
        extractFilePathFromToolOutput(step.toolOutput) ||
        extractFilePathFromToolInput(step.toolInput);
      if (!fallbackPath) continue;

      const resolvedPath = resolveArtifactPath(fallbackPath, currentWorkingDir);
      const key = resolvedPath.trim();
      if (!key || seenPaths.has(key)) continue;

      seenPaths.add(key);
      items.push({ label: getArtifactLabel(fallbackPath), path: resolvedPath });
    }

    return items;
  }, [currentWorkingDir, displayArtifactSteps]);

  return (
    <>
      <div
        className="
        absolute top-3 right-3 z-50
        w-[360px] max-h-[55vh]
        bg-background
        border border-border-subtle rounded-2xl shadow-2xl
        flex flex-col overflow-hidden
        animate-fade-in
      "
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-text-muted" />
            <span className="text-sm font-medium text-text-primary">
              {t("artifactPanel.title", "产物")}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 py-1">
          {displayArtifacts.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-4 text-xs text-text-muted">
              <Layers className="w-3.5 h-3.5 shrink-0" />
              <span>{t("context.noArtifactsYet", "尚无产物")}</span>
            </div>
          ) : (
            displayArtifacts.map((artifact, index) => {
              const label =
                artifact.label || t("context.fileCreated", "文件已创建");
              const artifactPath = artifact.path;
              const canClick = Boolean(artifactPath && canOpenPath);
              const ext = artifactPath
                .slice(artifactPath.lastIndexOf("."))
                .toLowerCase();

              return (
                <div
                  key={artifact.path || artifact.label || `artifact-${index}`}
                  className={`flex items-center gap-2.5 px-4 py-2 transition-colors ${
                    canClick ? "cursor-pointer hover:bg-surface-hover" : ""
                  }`}
                  onClick={() => {
                    if (!canClick) return;
                    handleClick(artifactPath, label);
                  }}
                  title={artifactPath || undefined}
                >
                  {getFileIcon(ext)}
                  <span className="text-sm text-text-primary truncate flex-1">
                    {label}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
      {/* File Preview Modal — portal to body so it renders full-screen */}
      {previewFile &&
        createPortal(
          <FilePreviewModal
            isOpen={true}
            filePath={previewFile.path}
            fileName={previewFile.name}
            onClose={() => setPreviewFile(null)}
          />,
          document.body,
        )}
    </>
  );
}
