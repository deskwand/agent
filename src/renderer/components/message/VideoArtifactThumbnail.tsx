import { useEffect, useState } from "react";
import { CirclePlay, Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { VideoReference } from "../../utils/video-reference";

interface VideoArtifactThumbnailProps {
  reference: VideoReference;
  onOpen: () => void;
}

export function VideoArtifactThumbnail({
  reference,
  onOpen,
}: VideoArtifactThumbnailProps) {
  const { t } = useTranslation();
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSrc("");
    setFailed(false);
    if (reference.playbackKind !== "inline") return;

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
    <button
      type="button"
      onClick={onOpen}
      aria-label={t("videoPlayer.previewLabel", { name: reference.name })}
      className="group min-w-0 overflow-hidden rounded-lg border border-border-subtle text-left transition-colors hover:bg-surface-hover"
    >
      <span className="relative flex aspect-video items-center justify-center overflow-hidden bg-background">
        {showVideo ? (
          <video
            src={src}
            muted
            preload="metadata"
            playsInline
            tabIndex={-1}
            className="pointer-events-none h-full w-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <Video className="h-8 w-8 text-text-muted" aria-hidden="true" />
        )}
        <CirclePlay
          className="absolute h-10 w-10 text-text-primary drop-shadow"
          aria-hidden="true"
        />
      </span>
      <span className="block truncate px-2.5 py-2 text-xs text-text-secondary">
        {reference.name}
      </span>
    </button>
  );
}
