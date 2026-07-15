import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, ExternalLink, Loader2, Video } from "lucide-react";
import { getVideoPlaybackKind } from "../../shared/video-file";

export interface VideoPlayerProps {
  filePath: string;
  fileName: string;
  compact?: boolean;
  showOpenExternal?: boolean;
  autoPlay?: boolean;
}

export function VideoPlayer({
  filePath,
  fileName,
  compact = false,
  showOpenExternal = true,
  autoPlay = false,
}: VideoPlayerProps) {
  const { t } = useTranslation();
  const kind = getVideoPlaybackKind(fileName);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [src, setSrc] = useState("");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setSrc("");

    if (!filePath || kind !== "inline") return;
    if (!window.electronAPI?.getVideoSourceUrl) {
      setStatus("error");
      return;
    }

    window.electronAPI
      .getVideoSourceUrl(filePath)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, kind]);

  const handleOpenExternal = async () => {
    if (filePath && window.electronAPI?.openPath) {
      await window.electronAPI.openPath(filePath);
    }
  };

  if (!filePath || kind !== "inline") {
    return (
      <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-surface-muted p-3">
        <Video className="h-5 w-5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-text-primary">{fileName}</p>
          <p className="text-xs text-text-muted">
            {t("videoPlayer.externalOnly")}
          </p>
        </div>
        {showOpenExternal && (
          <button
            type="button"
            onClick={() => void handleOpenExternal()}
            className="flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t("videoPlayer.openExternal")}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface-muted">
      <div
        className={`relative bg-background ${compact ? "max-h-48" : "max-h-[60vh]"}`}
      >
        {src && (
          <video
            src={src}
            controls
            autoPlay={autoPlay}
            preload="metadata"
            playsInline
            aria-label={t("videoPlayer.previewLabel", { name: fileName })}
            className="aspect-video h-auto w-full object-contain"
            onLoadedMetadata={() => setStatus("ready")}
            onError={() => setStatus("error")}
          />
        )}
        {status === "loading" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/70">
            <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
            <span className="sr-only">{t("videoPlayer.loading")}</span>
          </div>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
        {status === "error" && (
          <AlertCircle className="h-4 w-4 shrink-0 text-error" />
        )}
        <p className="min-w-0 flex-1 truncate text-xs text-text-primary">
          {status === "error" ? t("videoPlayer.playbackFailed") : fileName}
        </p>
        {(showOpenExternal || status === "error") && (
          <button
            type="button"
            onClick={() => void handleOpenExternal()}
            className="flex shrink-0 items-center gap-1.5 rounded-xl px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t("videoPlayer.openExternal")}
          </button>
        )}
      </div>
    </div>
  );
}
