/**
 * 内联产物的沙箱框架。高度固定 320px——iframe 无法自动量高（除非产物配合
 * postMessage 报高度，v1 不做），外层容器上限 420px，超出那么在容器内滚动。
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
import { Tooltip } from "../Tooltip";
import type { InlineArtifactInfo } from "../../utils/inline-artifacts";

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
      .getRenderUrl(artifact.path)
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
  }, [artifact.path, expanded, reloadToken]);

  const handleOpenInBrowser = useCallback(() => {
    openFilePathInBrowser(artifact.path);
  }, [artifact.path]);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => onToggle(artifact.path)}
        className="flex w-full items-center gap-2 rounded-md border border-border bg-surface-muted px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
      >
        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate font-medium">{label}</span>
      </button>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border bg-surface-muted px-2 py-1.5">
        <button
          type="button"
          onClick={() => onToggle(artifact.path)}
          className="flex min-w-0 items-center gap-2 text-xs text-text-primary"
        >
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate font-medium">{label}</span>
        </button>
        <div className="ml-auto flex items-center gap-1">
          <Tooltip label={t("artifact.inline.reload")}>
            <button
              type="button"
              aria-label={t("artifact.inline.reload")}
              onClick={() => setReloadToken((token) => token + 1)}
              className="rounded p-1 text-text-muted hover:bg-surface-hover"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip label={t("artifact.inline.openInBrowser")}>
            <button
              type="button"
              aria-label={t("artifact.inline.openInBrowser")}
              onClick={handleOpenInBrowser}
              className="rounded p-1 text-text-muted hover:bg-surface-hover"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      {state.kind === "failed" ? (
        <div
          data-testid="artifact-inline-failed"
          className="flex items-center gap-2 px-3 py-4 text-xs text-error"
        >
          <span>{t("artifact.inline.failed")}</span>
          <button
            type="button"
            onClick={() => setReloadToken((token) => token + 1)}
            className="underline"
          >
            {t("artifact.inline.retry")}
          </button>
        </div>
      ) : (
        <div className="relative max-h-[420px] overflow-auto">
          {!loaded ? (
            <div className="h-32 animate-pulse bg-surface-muted" />
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
