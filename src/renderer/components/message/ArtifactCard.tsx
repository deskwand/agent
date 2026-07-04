import { memo, useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Check, Undo2 } from "lucide-react";
import { useAppStore } from "../../store";
import { useIPC } from "../../hooks/useIPC";
import type { Session } from "../../types";
import type { ResultFileEntry } from "../../utils/tool-display-blocks";
import { shortenPath } from "./toolHelpers";
import { resolvePathAgainstWorkspace } from "../../../shared/workspace-path";
import { FilePreviewModal } from "../FilePreviewModal";
import { ConfirmDialog } from "../ConfirmDialog";

interface ArtifactCardProps {
  files: ResultFileEntry[];
  isLatestRound: boolean;
}

function isEdited(f: ResultFileEntry): boolean {
  return f.edits > 0;
}

function isNew(f: ResultFileEntry): boolean {
  return f.writes > 0 && f.edits === 0;
}

export const ArtifactCard = memo(function ArtifactCard({
  files,
  isLatestRound,
}: ArtifactCardProps) {
  const { t } = useTranslation();
  const { isElectron } = useIPC();

  const activeSessionCwd = useAppStore((s) => {
    const sid = s.activeSessionId;
    if (!sid) return undefined;
    const session = (s.sessions as Session[]).find(
      (ses) => ses.id === sid,
    );
    return session?.cwd || undefined;
  });
  const toggleReviewPanel = useAppStore((s) => s.toggleReviewPanel);
  const setReviewOpen = useAppStore((s) => s.setReviewOpen);
  const setReviewTargetFile = useAppStore((s) => s.setReviewTargetFile);

  const [previewFile, setPreviewFile] = useState<ResultFileEntry | null>(null);
  const [revertedFiles, setRevertedFiles] = useState<Set<string>>(new Set());
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [revertConfirm, setRevertConfirm] = useState<
    | { type: "file"; file: ResultFileEntry }
    | { type: "round" }
    | null
  >(null);
  const [revertError, setRevertError] = useState<string | null>(null);
  const [isGitRepo, setIsGitRepo] = useState(true);
  const [hasGitChanges, setHasGitChanges] = useState(true);

  // Detect whether the working directory is a git repo and has uncommitted changes
  useEffect(() => {
    if (!isElectron || !activeSessionCwd) return;
    const gitApi = window.electronAPI?.git;
    if (!gitApi?.hasChanges) {
      setIsGitRepo(false);
      setHasGitChanges(false);
      return;
    }
    (gitApi.hasChanges as (cwd: string) => Promise<{ isRepo: boolean; changeCount: number }>)(activeSessionCwd)
      .then((r) => {
        setIsGitRepo(r.isRepo);
        setHasGitChanges(r.isRepo && r.changeCount > 0);
      })
      .catch(() => {
        setIsGitRepo(false);
        setHasGitChanges(false);
      });
  }, [activeSessionCwd, isElectron]);

  const editedFiles = files.filter(isEdited);
  const newFiles = files.filter(isNew);

  if (editedFiles.length === 0 && newFiles.length === 0) {
    return null;
  }

  const handleCopyPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
    } catch {
      // Clipboard unavailable — silently ignore
    }
  }, []);

  // Clean up copiedPath indicator after 2s
  useEffect(() => {
    if (!copiedPath) return;
    const id = setTimeout(() => setCopiedPath(null), 2000);
    return () => clearTimeout(id);
  }, [copiedPath]);

  const doRevert = useCallback(
    async (entries: ResultFileEntry[]) => {
      if (!isElectron || !activeSessionCwd) return;
      setRevertError(null);

      const gitApi = window.electronAPI?.git as
        | {
            revertFiles?: (cwd: string, paths: string[]) => Promise<{ success: boolean; error?: string }>;
          }
        | undefined;
      if (!gitApi?.revertFiles) {
        setRevertError(t("artifactCard.revertFailed"));
        return;
      }

      const reverted: string[] = [];

      try {
        const paths = entries.map((entry) => entry.path);
        const result = await gitApi.revertFiles(activeSessionCwd, paths);
        if (result?.success) {
          reverted.push(...paths);
        } else {
          setRevertError(result?.error || t("artifactCard.revertFailed"));
          return;
        }

        if (reverted.length > 0) {
          setRevertedFiles((prev) => {
            const next = new Set(prev);
            reverted.forEach((p) => next.add(p));
            return next;
          });
          // Re-check git status to potentially hide review button
          const gitHasChanges = window.electronAPI?.git?.hasChanges;
          if (gitHasChanges) {
            (gitHasChanges as (cwd: string) => Promise<{ isRepo: boolean; changeCount: number }>)(activeSessionCwd)
              .then((r) => setHasGitChanges(r.changeCount > 0))
              .catch(() => {});
          }
        }
      } catch {
        setRevertError(t("artifactCard.revertFailed"));
      }
    },
    [activeSessionCwd, isElectron, t],
  );

  const handleRevertFile = useCallback(
    (file: ResultFileEntry) => {
      if (!isElectron || !isGitRepo) return;
      setRevertConfirm({ type: "file", file });
    },
    [isElectron, isGitRepo],
  );

  const handleRevertRound = useCallback(() => {
    if (!isElectron || !isGitRepo) return;
    setRevertConfirm({ type: "round" });
  }, [isElectron, isGitRepo]);

  const isUndoDisabled = !isElectron || !isGitRepo;

  const confirmRevert = useCallback(async () => {
    if (!revertConfirm) return;
    if (revertConfirm.type === "file") {
      await doRevert([revertConfirm.file]);
    } else {
      await doRevert(files);
    }
    setRevertConfirm(null);
  }, [revertConfirm, doRevert, files]);

  const resolvePath = (p: string) =>
    activeSessionCwd ? resolvePathAgainstWorkspace(p, activeSessionCwd) : p;

  const handleClickFile = useCallback(
    (file: ResultFileEntry) => {
      if (revertedFiles.has(file.path)) return;
      const resolvedPath = resolvePath(file.path);
      if (isNew(file) || !isGitRepo) {
        setPreviewFile({ ...file, path: resolvedPath });
      } else {
        setReviewTargetFile(resolvedPath);
        setReviewOpen(true);
      }
    },
    [revertedFiles, isGitRepo, resolvePath, setReviewTargetFile, setReviewOpen],
  );

  const handleReviewAll = useCallback(() => {
    if (!isGitRepo || !hasGitChanges) return;
    toggleReviewPanel();
  }, [isGitRepo, hasGitChanges, toggleReviewPanel]);

  return (
    <>
      <div className="rounded-xl border border-border bg-surface px-4 py-3.5 shadow-soft">
        {/* Title */}
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-accent">
          <span aria-hidden="true">✨</span>
          {t("artifactCard.title")}
        </div>

        {/* Edited files group */}
        {editedFiles.length > 0 ? (
          <div className="mb-2 rounded-lg bg-surface-muted px-3 py-2">
            <div className="mb-2 text-[11px] font-medium text-text-muted">
              {t("artifactCard.editedFiles")}
            </div>
            <div className="flex flex-col gap-0.5">
              {editedFiles.map((file) => {
                const reverted = revertedFiles.has(file.path);
                return (
                  <div
                    key={file.path}
                    className={`group flex items-center justify-between rounded-md px-2 py-1.5 font-mono text-[11px] leading-tight transition-colors outline-none ${
                      reverted
                        ? "cursor-default text-text-muted line-through"
                        : "cursor-pointer hover:bg-surface-hover active:bg-surface-active text-text-secondary focus-visible:ring-2 focus-visible:ring-accent"
                    }`}
                    onClick={() => handleClickFile(file)}
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" || e.key === " ") && !reverted) {
                        e.preventDefault();
                        handleClickFile(file);
                      }
                    }}
                    role={reverted ? undefined : "button"}
                    tabIndex={reverted ? -1 : 0}
                    title={
                      isUndoDisabled
                        ? t("artifactCard.desktopOnly")
                        : reverted
                          ? t("artifactCard.reverted")
                          : t("artifactCard.editedFiles")
                    }
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {shortenPath(file.path)}
                    </span>
                    <span
                      className="ml-2 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!reverted) handleCopyPath(resolvePath(file.path));
                      }}
                      role="button"
                      tabIndex={-1}
                    >
                      {copiedPath === file.path ? (
                        <Check className="h-3 w-3 text-success" />
                      ) : (
                        <Copy className="h-3 w-3 text-text-muted hover:text-text-secondary" />
                      )}
                    </span>
                    {isLatestRound && !reverted && isGitRepo ? (
                      <button
                        type="button"
                        className="ml-1 shrink-0 rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:bg-error/10 hover:text-error group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRevertFile(file);
                        }}
                        title={isUndoDisabled ? t("artifactCard.desktopOnly") : t("artifactCard.revertFile")}
                        disabled={isUndoDisabled}
                      >
                        <Undo2 className="h-3 w-3" />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* New files group */}
        {newFiles.length > 0 ? (
          <div className="mb-2 rounded-lg bg-success/5 px-3 py-2">
            <div className="mb-2 text-[11px] font-medium text-text-muted">
              {t("artifactCard.newFiles")}
            </div>
            <div className="flex flex-col gap-0.5">
              {newFiles.map((file) => {
                const reverted = revertedFiles.has(file.path);
                return (
                  <div
                    key={file.path}
                    className={`group flex items-center justify-between rounded-md px-2 py-1.5 font-mono text-[11px] leading-tight transition-colors outline-none ${
                      reverted
                        ? "cursor-default text-text-muted line-through"
                        : "cursor-pointer hover:bg-success/10 active:bg-success/15 text-success focus-visible:ring-2 focus-visible:ring-accent"
                    }`}
                    onClick={() => handleClickFile(file)}
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" || e.key === " ") && !reverted) {
                        e.preventDefault();
                        handleClickFile(file);
                      }
                    }}
                    role={reverted ? undefined : "button"}
                    tabIndex={reverted ? -1 : 0}
                    title={
                      isUndoDisabled
                        ? t("artifactCard.desktopOnly")
                        : reverted
                          ? t("artifactCard.reverted")
                          : t("artifactCard.newFiles")
                    }
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {shortenPath(file.path)}
                    </span>
                    <span
                      className="ml-2 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!reverted) handleCopyPath(resolvePath(file.path));
                      }}
                      role="button"
                      tabIndex={-1}
                    >
                      {copiedPath === file.path ? (
                        <Check className="h-3 w-3 text-success" />
                      ) : (
                        <Copy className="h-3 w-3 text-text-muted hover:text-text-secondary" />
                      )}
                    </span>
                    {isLatestRound && !reverted && isGitRepo ? (
                      <button
                        type="button"
                        className="ml-1 shrink-0 rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:bg-error/10 hover:text-error group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRevertFile(file);
                        }}
                        title={isUndoDisabled ? t("artifactCard.desktopOnly") : t("artifactCard.revertFile")}
                        disabled={isUndoDisabled}
                      >
                        <Undo2 className="h-3 w-3" />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Bottom actions */}
        <div className="flex items-center justify-between text-[11px]">
          {isLatestRound && isGitRepo ? (
            <button
              type="button"
              className="font-medium text-error transition-colors hover:text-error disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleRevertRound}
              disabled={isUndoDisabled || revertedFiles.size === files.length}
              title={isUndoDisabled ? t("artifactCard.desktopOnly") : undefined}
            >
              ↩ {t("artifactCard.revertRound")}
            </button>
          ) : (
            <span />
          )}
          {isGitRepo && hasGitChanges ? (
            <button
              type="button"
              className="font-medium text-accent transition-colors hover:text-accent-hover"
              onClick={handleReviewAll}
            >
              {t("artifactCard.reviewChanges")} →
            </button>
          ) : (
            <span />
          )}
        </div>

        {/* Revert error */}
        {revertError ? (
          <div className="mt-2 text-[11px] text-error">{revertError}</div>
        ) : null}
      </div>

      {/* Confirm dialog */}
      <ConfirmDialog
        isOpen={revertConfirm !== null}
        title={
          revertConfirm?.type === "file"
            ? t("artifactCard.confirmRevertFile", {
                path: resolvePath(revertConfirm.file.path),
              })
            : t("artifactCard.confirmRevertRound")
        }
        confirmLabel={t("artifactCard.revertRound")}
        onConfirm={confirmRevert}
        onCancel={() => setRevertConfirm(null)}
      />

      {/* File preview modal */}
      {previewFile ? (
        <FilePreviewModal
          isOpen
          filePath={previewFile.path}
          fileName={
            previewFile.path.split("/").pop() || previewFile.path
          }
          onClose={() => setPreviewFile(null)}
        />
      ) : null}
    </>
  );
});
