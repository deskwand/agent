/**
 * 产物按扩展名分派打开方式（浏览器 / 预览 / Office / 系统应用）。
 * 概览「输出内容」是当前唯一调用方；以后再加产出入口时复用这里，
 * 复制一份必然漂移（原先的产物面板就是第二份，已于 2026-10-26 移除）。
 */
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import {
  extOf,
  resolveFileReferencePath,
  resolveOpenAction,
} from "../utils/open-file-by-ext";
import { openFilePathInBrowser } from "../utils/open-in-browser";
import { openOfficePreview } from "../utils/office-preview-runner";
import { usePaneSessionId } from "../components/split/pane-context";

export function useOpenArtifact(): {
  openArtifact: (pathValue: string, label: string) => Promise<void>;
  canOpenPath: boolean;
} {
  const { t } = useTranslation();
  const workingDir = useAppStore((s) => s.workingDir);
  const paneSessionId = usePaneSessionId();
  const activeSessionCwd = useAppStore((s) => {
    const sid = paneSessionId;
    if (!sid) return undefined;
    return s.sessions.find((session) => session.id === sid)?.cwd;
  });
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);
  const openPreview = useAppStore((s) => s.openPreview);
  const currentWorkingDir = activeSessionCwd || workingDir;
  const canOpenPath =
    typeof window !== "undefined" && !!window.electronAPI?.openPath;

  const openArtifact = useCallback(
    async (pathValue: string, label: string) => {
      const resolvedArtifact = await resolveFileReferencePath(
        pathValue,
        currentWorkingDir,
      );
      const action = resolveOpenAction(extOf(resolvedArtifact));
      if (action === "browser") {
        openFilePathInBrowser(resolvedArtifact);
        return;
      }
      if (action === "preview") {
        openPreview({ path: resolvedArtifact, name: label });
        return;
      }
      if (action === "office") {
        void openOfficePreview(resolvedArtifact, {
          t,
          onSuccess: (outPath: string) => openFilePathInBrowser(outPath),
          onFailure: () => {
            void window.electronAPI?.openPath?.(resolvedArtifact);
            setGlobalNotice({
              id: `office-preview-failed-${Date.now()}`,
              type: "warning",
              message: t("filePreview.officeRenderFailed"),
            });
          },
        });
        return;
      }
      if (!canOpenPath) return;
      const result = await window.electronAPI!.openPath(resolvedArtifact);
      if (result.error) {
        setGlobalNotice({
          id: `artifact-open-failed-${Date.now()}`,
          type: "warning",
          message: t("context.openFailed", { error: result.error }),
        });
      }
    },
    [canOpenPath, currentWorkingDir, openPreview, setGlobalNotice, t],
  );

  return { openArtifact, canOpenPath };
}
