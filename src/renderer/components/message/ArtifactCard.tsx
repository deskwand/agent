import { memo, useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Check, Copy, CirclePlay, Video } from "lucide-react";
import { useAppStore } from "../../store";
import { useIPC } from "../../hooks/useIPC";
import type { Session } from "../../types";
import type { ResultFileEntry } from "../../utils/tool-display-blocks";
import {
  normalizeVideoReferencePath,
  type VideoReference,
} from "../../utils/video-reference";
import { shortenPath } from "./toolHelpers";
import { resolvePathAgainstWorkspace } from "../../../shared/workspace-path";
import { FilePreviewModal } from "../FilePreviewModal";
import { ConfirmDialog } from "../ConfirmDialog";

interface ArtifactCardProps {
  files: ResultFileEntry[];
  videoReferences: VideoReference[];
  isLatestRound: boolean;
}

function isEdited(f: ResultFileEntry): boolean {
  return f.edits > 0;
}

function isNew(f: ResultFileEntry): boolean {
  return f.writes > 0 && f.edits === 0;
}

function getFileExt(filePath: string): string {
  const name = filePath.split(/[/\\]/).pop() || filePath;
  // dotfiles: show the full name (e.g. ".gitignore" → ".git")
  if (name.startsWith(".") && name.lastIndexOf(".") === 0) {
    return name.slice(0, 4).toUpperCase();
  }
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return name.slice(0, 4).toUpperCase();
  return name
    .slice(dot + 1)
    .slice(0, 4)
    .toUpperCase();
}

function VideoThumb({ reference }: { reference: VideoReference }) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSrc("");
    setFailed(false);
    if (reference.playbackKind !== "inline") {
      setFailed(true);
      return;
    }
    const getSourceUrl = window.electronAPI?.getVideoSourceUrl;
    if (!getSourceUrl) {
      setFailed(true);
      return;
    }
    getSourceUrl(reference.path)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reference.path, reference.playbackKind]);

  const showVideo =
    reference.playbackKind === "inline" && Boolean(src) && !failed;

  return (
    <div className="relative flex h-9 w-[60px] shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-muted">
      {showVideo ? (
        <video
          src={src}
          muted
          preload="metadata"
          playsInline
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Video className="h-4 w-4 text-text-muted" />
      )}
      {showVideo ? (
        <CirclePlay className="absolute h-5 w-5 text-white drop-shadow" />
      ) : null}
    </div>
  );
}

export const ArtifactCard = memo(function ArtifactCard({
  files,
  videoReferences = [],
  isLatestRound,
}: ArtifactCardProps) {
  const { t } = useTranslation();
  const { isElectron } = useIPC();

  const activeSessionCwd = useAppStore((s) => {
    const sid = s.activeSessionId;
    if (!sid) return undefined;
    const session = (s.sessions as Session[]).find((ses) => ses.id === sid);
    return session?.cwd || undefined;
  });
  const setReviewOpen = useAppStore((s) => s.setReviewOpen);
  const setReviewTargetFile = useAppStore((s) => s.setReviewTargetFile);

  const [previewFile, setPreviewFile] = useState<{
    path: string;
    autoPlay?: boolean;
  } | null>(null);
  const [revertedFiles, setRevertedFiles] = useState<Set<string>>(new Set());
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [revertConfirm, setRevertConfirm] = useState<ResultFileEntry | null>(
    null,
  );
  const [revertError, setRevertError] = useState<string | null>(null);
  const [isGitRepo, setIsGitRepo] = useState(true);

  useEffect(() => {
    if (!isElectron || !activeSessionCwd) return;
    const gitApi = window.electronAPI?.git;
    if (!gitApi?.hasChanges) {
      setIsGitRepo(false);
      return;
    }
    (
      gitApi.hasChanges as (
        cwd: string,
      ) => Promise<{ isRepo: boolean; changeCount: number }>
    )(activeSessionCwd)
      .then((r) => setIsGitRepo(r.isRepo))
      .catch(() => setIsGitRepo(false));
  }, [activeSessionCwd, isElectron]);

  const resolvePath = (filePath: string) =>
    activeSessionCwd
      ? resolvePathAgainstWorkspace(filePath, activeSessionCwd)
      : filePath;

  const videoPathKeys = new Set(
    videoReferences.map((ref) => normalizeVideoReferencePath(ref.path)),
  );
  const isDuplicateVideoRow = (file: ResultFileEntry) =>
    videoPathKeys.has(normalizeVideoReferencePath(resolvePath(file.path)));

  const editedFiles = files
    .filter(isEdited)
    .filter((file) => !isDuplicateVideoRow(file));
  const newFiles = files
    .filter(isNew)
    .filter((file) => !isDuplicateVideoRow(file));

  const allItems: Array<
    | { kind: "video"; reference: VideoReference }
    | { kind: "file"; file: ResultFileEntry; status: "edited" | "new" }
  > = [
    ...videoReferences.map((ref) => ({
      kind: "video" as const,
      reference: ref,
    })),
    ...editedFiles.map((file) => ({
      kind: "file" as const,
      file,
      status: "edited" as const,
    })),
    ...newFiles.map((file) => ({
      kind: "file" as const,
      file,
      status: "new" as const,
    })),
  ];

  const handleCopyPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
    } catch {
      // Clipboard unavailable — silently ignore
    }
  }, []);

  useEffect(() => {
    if (!copiedPath) return;
    const id = setTimeout(() => setCopiedPath(null), 2000);
    return () => clearTimeout(id);
  }, [copiedPath]);

  const doRevert = useCallback(
    async (entry: ResultFileEntry) => {
      if (!isElectron || !activeSessionCwd) return;
      setRevertError(null);

      const gitApi = window.electronAPI?.git as
        | {
            revertFiles?: (
              cwd: string,
              paths: string[],
            ) => Promise<{ success: boolean; error?: string }>;
          }
        | undefined;
      if (!gitApi?.revertFiles) {
        setRevertError(t("artifactCard.revertFailed"));
        return;
      }

      try {
        const result = await gitApi.revertFiles(activeSessionCwd, [entry.path]);
        if (result?.success) {
          setRevertedFiles((prev) => {
            const next = new Set(prev);
            next.add(entry.path);
            return next;
          });
        } else {
          setRevertError(result?.error || t("artifactCard.revertFailed"));
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
      setRevertConfirm(file);
    },
    [isElectron, isGitRepo],
  );

  const isUndoDisabled = !isElectron || !isGitRepo;

  const confirmRevert = useCallback(async () => {
    if (!revertConfirm) return;
    await doRevert(revertConfirm);
    setRevertConfirm(null);
  }, [revertConfirm, doRevert]);

  const handleClickFile = useCallback(
    async (file: ResultFileEntry) => {
      if (revertedFiles.has(file.path)) return;
      const resolvedPath = resolvePath(file.path);
      const openPreview = () => {
        setPreviewFile({ ...file, path: resolvedPath });
      };

      if (isNew(file) || !isGitRepo || !activeSessionCwd) {
        openPreview();
        return;
      }

      const getDiffFiles = window.electronAPI?.review?.getDiffFiles;
      if (!getDiffFiles) {
        openPreview();
        return;
      }

      try {
        const diffFiles = await getDiffFiles(activeSessionCwd);
        const normalizedResolvedPath = resolvedPath.replace(/\\/g, "/");
        const normalizedWorkingDir = activeSessionCwd
          .replace(/\\/g, "/")
          .replace(/\/+$/, "");
        const normalizedFilePath = file.path
          .replace(/\\/g, "/")
          .replace(/^\.\/+/, "");
        const workspaceRelativePath = normalizedResolvedPath.startsWith(
          `${normalizedWorkingDir}/`,
        )
          ? normalizedResolvedPath.slice(normalizedWorkingDir.length + 1)
          : normalizedFilePath;
        const matchingDiffFile = diffFiles.find(({ path: dp }) => {
          const normalizedDiffPath = dp.replace(/\\/g, "/");
          return (
            normalizedDiffPath === workspaceRelativePath ||
            normalizedDiffPath.endsWith(`/${workspaceRelativePath}`)
          );
        });

        if (!matchingDiffFile) {
          openPreview();
          return;
        }

        setReviewTargetFile(matchingDiffFile.path);
        setReviewOpen(true);
      } catch {
        openPreview();
      }
    },
    [
      activeSessionCwd,
      isGitRepo,
      resolvePath,
      revertedFiles,
      setReviewTargetFile,
      setReviewOpen,
    ],
  );

  const handleClickVideo = useCallback((reference: VideoReference) => {
    setPreviewFile({ path: reference.path, autoPlay: true });
  }, []);

  if (allItems.length === 0) return null;

  return (
    <>
      <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto">
        {allItems.map((item) => {
          if (item.kind === "video") {
            const ref = item.reference;
            const key = normalizeVideoReferencePath(ref.path);
            return (
              <div
                key={key}
                className="flex cursor-pointer items-center justify-between rounded-xl border border-border-subtle px-4 py-3.5 transition-colors hover:bg-surface-hover/50"
                onClick={() => handleClickVideo(ref)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleClickVideo(ref);
                  }
                }}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <VideoThumb reference={ref} />
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold text-text-primary">
                      {ref.name}
                    </div>
                  </div>
                </div>
                <div className="ml-3 flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    className="rounded-md border border-border-subtle px-2.5 py-1 text-xs text-accent hover:bg-accent/5"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClickVideo(ref);
                    }}
                  >
                    {t("artifactCard.play")}
                  </button>
                </div>
              </div>
            );
          }

          // file card
          const { file, status } = item;
          const reverted = revertedFiles.has(file.path);
          const ext = getFileExt(file.path);
          const canRevert = isLatestRound && !reverted && isGitRepo;

          return (
            <div
              key={file.path}
              className={`flex items-center justify-between rounded-xl border border-border-subtle px-4 py-3.5 transition-colors outline-none ${
                reverted
                  ? "cursor-default opacity-50"
                  : "cursor-pointer hover:bg-surface-hover/50"
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
              title={reverted ? t("artifactCard.reverted") : undefined}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-xs font-semibold text-text-muted ${
                    reverted ? "line-through" : ""
                  }`}
                >
                  {ext}
                </div>
                <div className="min-w-0">
                  <div
                    className={`truncate text-base font-semibold text-text-primary ${
                      reverted ? "line-through text-text-muted" : ""
                    }`}
                  >
                    {shortenPath(file.path)}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
                    {status === "edited" ? (
                      <>
                        <span className="text-success">+{file.addedLines}</span>
                        <span className="text-error">-{file.removedLines}</span>
                        <span>·</span>
                        <span>{t("artifactCard.statusEdited")}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-success">+{file.addedLines}</span>
                        <span className="text-error">-{file.removedLines}</span>
                        <span>·</span>
                        <span>{t("artifactCard.statusNew")}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="ml-3 flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  className="rounded-md p-1 text-text-muted hover:bg-surface-hover hover:text-text-secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!reverted) handleCopyPath(resolvePath(file.path));
                  }}
                  title={t("artifactCard.copyPath")}
                >
                  {copiedPath === resolvePath(file.path) ? (
                    <Check className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
                {canRevert ? (
                  <button
                    type="button"
                    className="rounded-md border border-border-subtle px-2.5 py-1 text-xs text-text-muted hover:border-error/20 hover:bg-error/5 hover:text-error"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRevertFile(file);
                    }}
                    title={
                      isUndoDisabled
                        ? t("artifactCard.desktopOnly")
                        : t("artifactCard.revertFile")
                    }
                    disabled={isUndoDisabled}
                  >
                    {t("artifactCard.revert")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded-md border border-border-subtle px-2.5 py-1 text-xs text-accent hover:bg-accent/5"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClickFile(file);
                  }}
                >
                  {status === "edited"
                    ? t("artifactCard.review")
                    : t("artifactCard.preview")}
                </button>
              </div>
            </div>
          );
        })}

        {revertError ? (
          <div className="text-xs text-error">{revertError}</div>
        ) : null}
      </div>

      <ConfirmDialog
        isOpen={revertConfirm !== null}
        title={
          revertConfirm
            ? t("artifactCard.confirmRevertFile", {
                path: resolvePath(revertConfirm.path),
              })
            : ""
        }
        confirmLabel={t("artifactCard.revert")}
        onConfirm={confirmRevert}
        onCancel={() => setRevertConfirm(null)}
      />

      {previewFile &&
        createPortal(
          <FilePreviewModal
            isOpen
            filePath={previewFile.path}
            fileName={previewFile.path.split(/[/\\]/).pop() || previewFile.path}
            autoPlay={previewFile.autoPlay}
            onClose={() => setPreviewFile(null)}
          />,
          document.body,
        )}
    </>
  );
});
