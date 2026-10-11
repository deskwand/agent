import { memo, useState, useCallback, useEffect } from "react";
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
import { ConfirmDialog } from "../ConfirmDialog";
import {
  extOf,
  resolveFileReferencePath,
  resolveOpenAction,
} from "../../utils/open-file-by-ext";
import { openOfficePreview } from "../../utils/office-preview-runner";
import { openFilePathInBrowser } from "../../utils/open-in-browser";
import { Tooltip, TooltipContent, TooltipTrigger } from "../app-tooltip";
import { Button } from "../app-button";
import { useIsGitRepo } from "../../hooks/use-is-git-repo";

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
    <div className="relative flex h-7 w-[50px] shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
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
        <Video className="h-4 w-4 text-muted-foreground" />
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
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);
  const { isElectron } = useIPC();

  const activeSessionCwd = useAppStore((s) => {
    const sid = s.activeSessionId;
    if (!sid) return undefined;
    const session = (s.sessions as Session[]).find((ses) => ses.id === sid);
    return session?.cwd || undefined;
  });
  const openReview = useAppStore((s) => s.openReview);
  const setReviewTargetFile = useAppStore((s) => s.setReviewTargetFile);
  const openPreview = useAppStore((s) => s.openPreview);

  const [revertedFiles, setRevertedFiles] = useState<Set<string>>(new Set());
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [revertConfirm, setRevertConfirm] = useState<ResultFileEntry | null>(
    null,
  );
  const [revertError, setRevertError] = useState<string | null>(null);
  // 与顶栏的代码审查入口共用同一支探针（同一个 cwd 只 spawn 一次 `git status`）。
  // `?? true` 是有意的：探针的 null 表示「没有 cwd」或「结论还没回来」，这两种情况下
  // 本文件原先的乐观默认就是 true —— 点击路由与回退按钮的行为因此不变。
  // 唯一的差异在浏览器模式（没有 git 桥 ⇒ 探针给 false）：点编辑过的文件行走预览，
  // 而不是今天那条打不开的审查路径。
  const isGitRepo = useIsGitRepo(activeSessionCwd) ?? true;

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
      const resolvedPath = await resolveFileReferencePath(
        file.path,
        activeSessionCwd ?? null,
      );
      const handleOpenFileRow = () => {
        const action = resolveOpenAction(extOf(resolvedPath));
        if (action === "browser") {
          openFilePathInBrowser(resolvedPath);
          return;
        }
        if (action === "office") {
          void openOfficePreview(resolvedPath, {
            t,
            onSuccess: (outPath) => openFilePathInBrowser(outPath),
            onFailure: () => {
              void window.electronAPI?.showItemInFolder?.(
                resolvedPath,
                activeSessionCwd ?? undefined,
              );
              setGlobalNotice({
                id: `office-preview-failed-${Date.now()}`,
                type: "warning",
                message: t("filePreview.officeRenderFailedRevealed"),
              });
            },
          });
          return;
        }
        // preview 与 fallback 都保持本文件原有的行为：进预览面板。
        openPreview({
          path: resolvedPath,
          name: resolvedPath.split(/[/\\]/).pop() || resolvedPath,
        });
      };

      if (isNew(file) || !isGitRepo || !activeSessionCwd) {
        handleOpenFileRow();
        return;
      }

      const getDiffFiles = window.electronAPI?.review?.getDiffFiles;
      if (!getDiffFiles) {
        handleOpenFileRow();
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
          handleOpenFileRow();
          return;
        }

        setReviewTargetFile(matchingDiffFile.path);
        openReview();
      } catch {
        handleOpenFileRow();
      }
    },
    [
      activeSessionCwd,
      isGitRepo,
      openPreview,
      openReview,
      revertedFiles,
      setGlobalNotice,
      setReviewTargetFile,
      t,
    ],
  );

  const handleClickVideo = useCallback(
    async (reference: VideoReference) => {
      const resolved = await resolveFileReferencePath(
        reference.path,
        activeSessionCwd ?? null,
      );
      openPreview({ path: resolved, name: reference.name, autoPlay: true });
    },
    [activeSessionCwd, openPreview],
  );

  if (allItems.length === 0) return null;

  return (
    <>
      <div className="flex flex-col gap-1.5 max-h-[320px] overflow-y-auto">
        {allItems.map((item) => {
          if (item.kind === "video") {
            const ref = item.reference;
            const key = normalizeVideoReferencePath(ref.path);
            return (
              <div
                key={key}
                className="flex cursor-pointer items-center justify-between rounded-xl border border-border/40 px-3 py-2 transition-colors hover:bg-accent/50"
                onClick={() => void handleClickVideo(ref)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    void handleClickVideo(ref);
                  }
                }}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <VideoThumb reference={ref} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {ref.name}
                    </div>
                  </div>
                </div>
                <div className="ml-3 flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="ghost"
                    type="button"
                    className="rounded-md border border-border/40 px-2.5 py-1 text-xs text-primary-text hover:bg-primary/5 h-auto"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleClickVideo(ref);
                    }}
                  >
                    {t("artifactCard.play")}
                  </Button>
                </div>
              </div>
            );
          }

          // file card
          const { file, status } = item;
          const reverted = revertedFiles.has(file.path);
          const ext = getFileExt(file.path);
          const canRevert = isLatestRound && !reverted && isGitRepo;
          const revertTipLabel = isUndoDisabled
            ? t("artifactCard.desktopOnly")
            : t("artifactCard.revertFile");

          return (
            <div
              key={file.path}
              /* 紧凑档尺寸（2026-10-10 定稿，1:1 量测见 design-docs/mockups）：
                 行标题 14px 与聊天正文同档（此前 16px 比正文还大一档，是「字体太大」的根因）；
                 内边距 8/12 、扩展名方块 28²（对齐仓库图标键的 w-7 h-7）、卡间距 6
                 ⇒ 单行 56px / 四行 242px（原 72 / 312，已经贴住 max-h-[320px] 才出滚动条）。
               */
              className={`flex items-center justify-between rounded-xl border border-border/40 px-3 py-2 transition-colors outline-none ${
                reverted
                  ? "cursor-default opacity-50"
                  : "cursor-pointer hover:bg-accent/50"
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
                  /* 方块 28² 对齐仓库图标键（`app-button` 的 `iconSm` 档、`BrowserPanel` 的 `w-7 h-7`）。
                     标签用 rem 任意值而非 `text-[10px]`：App.tsx 把「设置 → 字号」做成根字号上的
                     `--ui-font-scale`，只有 rem 会缩放；方块自身是 h-7/w-7（rem）⇒ 写死 px 时
                     把字号调到 12 会让 4 字符扩展名漫出方块（HEAD 的 36² 方块不会）。
                     容量边界：4 字符最坏情况（MAKE / DOCK）约 28.6px、方块宽 28px ⇒ 靠
                     overflow-hidden 兜底（裁不到的 0.3px），不至于溢出到方块外。 */
                  className={`flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-[0.625rem] font-semibold text-muted-foreground ${
                    reverted ? "line-through" : ""
                  }`}
                >
                  {ext}
                </div>
                <div className="min-w-0">
                  <div
                    className={`truncate text-sm font-medium text-foreground ${
                      reverted ? "line-through text-muted-foreground" : ""
                    }`}
                  >
                    {shortenPath(file.path)}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    {status === "edited" ? (
                      <>
                        {!file.lineStatsUnavailable && (
                          <>
                            <span className="text-success">
                              +{file.addedLines}
                            </span>
                            <span className="text-destructive">
                              -{file.removedLines}
                            </span>
                            <span>·</span>
                          </>
                        )}
                        <span>{t("artifactCard.statusEdited")}</span>
                      </>
                    ) : (
                      <>
                        {!file.lineStatsUnavailable && (
                          <>
                            <span className="text-success">
                              +{file.addedLines}
                            </span>
                            <span className="text-destructive">
                              -{file.removedLines}
                            </span>
                            <span>·</span>
                          </>
                        )}
                        <span>{t("artifactCard.statusNew")}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="ml-3 flex shrink-0 items-center gap-1.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      type="button"
                      className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-muted-foreground h-auto"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!reverted) handleCopyPath(resolvePath(file.path));
                      }}
                      aria-label={t("artifactCard.copyPath")}
                    >
                      {copiedPath === resolvePath(file.path) ? (
                        <Check className="h-3.5 w-3.5 text-success" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {t("artifactCard.copyPath")}
                  </TooltipContent>
                </Tooltip>
                {/* 还原按钮有可见文字，所以只换提示、不补 aria-label，
                    否则会覆盖可见文字（违反 WCAG 2.5.3）。 */}
                {canRevert ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        type="button"
                        className="rounded-md border border-border/40 px-2.5 py-1 text-xs text-muted-foreground hover:border-destructive/20 hover:bg-destructive/5 hover:text-destructive h-auto"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRevertFile(file);
                        }}
                        disabled={isUndoDisabled}
                      >
                        {t("artifactCard.revert")}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {revertTipLabel}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
                <Button
                  variant="ghost"
                  type="button"
                  className="rounded-md border border-border/40 px-2.5 py-1 text-xs text-primary-text hover:bg-primary/5 h-auto"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClickFile(file);
                  }}
                >
                  {status === "edited"
                    ? t("artifactCard.review")
                    : t("artifactCard.preview")}
                </Button>
              </div>
            </div>
          );
        })}

        {revertError ? (
          <div className="text-xs text-destructive">{revertError}</div>
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
    </>
  );
});
