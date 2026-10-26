/**
 * 内联产物的沙箱框架。高度固定 320px——iframe 无法自动量高（除非产物配合
 * postMessage 报高度，v1 不做）。
 * 两个高度约束是为了「展开只变一次高度」：
 *   1. 折叠与展开的头部用同一档 min-height（两态同高，切换时这一行不跳）；
 *   2. 内容区在 onLoad 之前就先占住 320px，骨架屏作为覆盖层盖在 iframe 上
 *      —— 两者并存会把内容擑到 448px，被 max-h-[420px] 裁一次、onLoad 后再掉回 320。
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  RotateCw,
} from "lucide-react";
import { openFilePathInBrowser } from "../../utils/open-in-browser";
import { Tooltip, TooltipContent, TooltipTrigger } from "../app-tooltip";
import { useAppStore } from "../../store";
import { resolvePathAgainstWorkspace } from "../../../shared/workspace-path";
import type { Session } from "../../types";
import type { InlineArtifactInfo } from "../../utils/inline-artifacts";
import { Button } from "../app-button";

/** 每次展开都重新取 URL：签名是进程内的，应用重启后就失效了。 */
type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; url: string }
  | { kind: "failed" };

export interface ArtifactInlineFrameProps {
  artifact: InlineArtifactInfo;
  expanded: boolean;
  onToggle: (path: string) => void;
}

export function ArtifactInlineFrame({
  artifact,
  expanded,
  onToggle,
}: ArtifactInlineFrameProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [reloadToken, setReloadToken] = useState(0);
  const [loaded, setLoaded] = useState(false);

  // 模型给的是相对工作区的路径（<file_references> 规则要求如此），而主进程的 cwd 是
  // 应用启动目录（打包后从 Dock 启动就是 `/`）——不解析就是 stat(ENOENT) → null → 失败行。
  // 解析方式与 ArtifactCard 保持一致。
  const activeSessionCwd = useAppStore((s) => {
    const sid = s.activeSessionId;
    if (!sid) return undefined;
    const session = (s.sessions as Session[]).find((ses) => ses.id === sid);
    return session?.cwd || undefined;
  });
  const resolvedPath = resolvePathAgainstWorkspace(
    artifact.path,
    activeSessionCwd,
  );

  const label =
    artifact.name ?? artifact.path.split(/[/\\]/).pop() ?? artifact.path;

  useEffect(() => {
    if (!expanded) {
      setState({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setLoaded(false);
    setState({ kind: "loading" });
    const api = window.electronAPI?.artifact;
    if (!api) {
      setState({ kind: "failed" });
      return;
    }
    api
      .getRenderUrl(resolvedPath)
      .then((url) => {
        if (cancelled) return;
        setState(url ? { kind: "ready", url } : { kind: "failed" });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [resolvedPath, expanded, reloadToken]);

  const handleOpenInBrowser = useCallback(() => {
    openFilePathInBrowser(resolvedPath);
  }, [resolvedPath]);

  if (!expanded) {
    return (
      <Button variant="ghost"
        type="button"
        onClick={() => onToggle(artifact.path)}
        className="flex min-h-9 w-full items-center gap-2 rounded-md border border-border bg-muted px-2 py-1.5 text-left text-xs text-foreground hover:bg-selected-surface h-auto"
      >
        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate font-medium">{label}</span>
      </Button>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <div className="flex min-h-9 items-center gap-2 border-b border-border bg-muted px-2 py-1.5">
        <Button variant="ghost"
          type="button"
          data-testid="artifact-inline-toggle"
          onClick={() => onToggle(artifact.path)}
          className="flex min-w-0 items-center gap-2 text-xs text-foreground h-auto px-0 hover:bg-transparent hover:text-current"
        >
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate font-medium">{label}</span>
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost"
                type="button"
                aria-label={t("artifact.inline.reload")}
                onClick={() => setReloadToken((token) => token + 1)}
                className="rounded p-1 text-muted-foreground hover:bg-hover-surface h-auto"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            {/* side 必须显式给 bottom：vendored TooltipContent 的 Radix 默认是 top，
                而老 Tooltip 的 placement 默认是下方 —— 不写会把气泡挪到按钮上方。 */}
            <TooltipContent side="bottom">
              {t("artifact.inline.reload")}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost"
                type="button"
                aria-label={t("artifact.inline.openInBrowser")}
                onClick={handleOpenInBrowser}
                className="rounded p-1 text-muted-foreground hover:bg-hover-surface h-auto"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t("artifact.inline.openInBrowser")}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {state.kind === "failed" ? (
        <div
          data-testid="artifact-inline-failed"
          className="flex items-center gap-2 px-3 py-4 text-xs text-destructive"
        >
          <span>{t("artifact.inline.failed")}</span>
          <Button variant="ghost"
            type="button"
            onClick={() => setReloadToken((token) => token + 1)}
            className="underline h-auto px-0 hover:bg-transparent hover:text-current"
          >
            {t("artifact.inline.retry")}
          </Button>
        </div>
      ) : (
        <div
          data-testid="artifact-inline-body"
          className={`relative max-h-[420px] overflow-auto ${
            loaded ? "" : "min-h-[320px]"
          }`}
        >
          {!loaded ? (
            <div
              data-testid="artifact-inline-skeleton"
              className="absolute inset-x-0 top-0 h-[320px] animate-pulse bg-muted"
            />
          ) : null}
          {state.kind === "ready" ? (
            <iframe
              title={label}
              sandbox="allow-scripts"
              src={state.url}
              onLoad={() => setLoaded(true)}
              className="h-[320px] w-full border-0"
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
