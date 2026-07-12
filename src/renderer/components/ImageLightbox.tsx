import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  AlertCircle,
  Loader2,
} from "lucide-react";

export interface ImageSource {
  src: string;
  name?: string;
  filePath?: string;
}

export interface ImageLightboxProps {
  isOpen: boolean;
  images: ImageSource[];
  startIndex?: number;
  onClose: () => void;
  loading?: boolean;
  error?: string | null;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 5.0;
const ZOOM_STEP = 0.25;

/** Clamp zoom value between min and max. Exported for testing. */
export function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

/** Calculate next zoom value with step, clamped. */
export function stepZoom(current: number, delta: number): number {
  return clampZoom(current + delta);
}

/** Round zoom to percentage for display. */
export function zoomPercent(zoom: number): number {
  return Math.round(zoom * 100);
}

export function ImageLightbox({
  isOpen,
  images,
  startIndex = 0,
  onClose,
  loading = false,
  error = null,
}: ImageLightboxProps) {
  const { t } = useTranslation();

  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [copyFeedback, setCopyFeedback] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset zoom/offset when switching images
  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [currentIndex]);

  // Sync startIndex on open
  useEffect(() => {
    if (isOpen) {
      const clamped = Math.min(Math.max(startIndex, 0), images.length - 1);
      setCurrentIndex(clamped);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setCopyFeedback(false);
    }
  }, [isOpen, startIndex, images.length]);

  const currentImage = images[currentIndex];
  const isSingle = images.length <= 1;

  const goNext = useCallback(() => {
    setCurrentIndex((prev) => Math.min(prev + 1, images.length - 1));
  }, [images.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  const resetZoom = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const adjustZoom = useCallback(
    (delta: number, clientX?: number, clientY?: number) => {
      setZoom((prev) => {
        const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev + delta));
        if (
          clientX !== undefined &&
          clientY !== undefined &&
          containerRef.current
        ) {
          const rect = containerRef.current.getBoundingClientRect();
          const cx = clientX - rect.left - rect.width / 2;
          const cy = clientY - rect.top - rect.height / 2;
          const ratio = next / prev;
          setOffset((o) => ({
            x: cx - ratio * (cx - o.x),
            y: cy - ratio * (cy - o.y),
          }));
        }
        return next;
      });
    },
    [],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      adjustZoom(delta, e.clientX, e.clientY);
    },
    [adjustZoom],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (zoom <= 1) return;
      e.preventDefault();
      setIsDragging(true);
      setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    },
    [zoom, offset],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      setOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    },
    [isDragging, dragStart],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDoubleClick = useCallback(() => {
    resetZoom();
  }, [resetZoom]);

  const handleCopy = useCallback(async () => {
    if (!currentImage) return;
    try {
      const img = new Image();
      if (!currentImage.src.startsWith("data:")) {
        img.crossOrigin = "anonymous";
      }
      img.src = currentImage.src;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Image load failed"));
      });
      const canvas = document.createElement("canvas");
      const MAX_DIM = 4096;
      const scale = Math.min(
        1,
        MAX_DIM / img.naturalWidth,
        MAX_DIM / img.naturalHeight,
      );
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No canvas context");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("Blob creation failed");
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      try {
        await navigator.clipboard.writeText(currentImage.src);
        setCopyFeedback(true);
        setTimeout(() => setCopyFeedback(false), 2000);
      } catch {
        // silent fail
      }
    }
  }, [currentImage]);

  const handleOpenExternal = useCallback(async () => {
    if (!currentImage?.filePath) return;
    try {
      await window.electronAPI?.openPath?.(currentImage.filePath);
    } catch {
      if (window.electronAPI?.openExternal) {
        await window.electronAPI.openExternal(
          `file://${currentImage.filePath}`,
        );
      }
    }
  }, [currentImage]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case "ArrowLeft":
          e.preventDefault();
          goPrev();
          break;
        case "ArrowRight":
          e.preventDefault();
          goNext();
          break;
        case "0":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            resetZoom();
          }
          break;
        case "=":
        case "+":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            adjustZoom(ZOOM_STEP);
          }
          break;
        case "-":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            adjustZoom(-ZOOM_STEP);
          }
          break;
        case "c":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            void handleCopy();
          }
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose, goNext, goPrev, resetZoom, adjustZoom, handleCopy]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [isOpen]);

  const displayPercent = useMemo(() => Math.round(zoom * 100), [zoom]);

  if (!isOpen || images.length === 0) return null;
  const imageSrc = currentImage?.src ?? "";
  const imageName = currentImage?.name ?? "";
  const hasFilePath = Boolean(currentImage?.filePath);

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/50 dark:bg-black/80 flex flex-col"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-4 py-2 bg-black/60 dark:bg-black/70 backdrop-blur-md text-white select-none shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-medium truncate">{imageName}</span>
          {!isSingle && (
            <span className="text-xs text-white/60 dark:text-white/50">
              {t("imageLightbox.imageCount", {
                current: currentIndex + 1,
                total: images.length,
              })}
            </span>
          )}
          {zoom !== 1 && (
            <span className="text-xs text-white/40">{displayPercent}%</span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-white/10 dark:hover:bg-white/15 transition-colors"
          aria-label={t("imageLightbox.close")}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* ── Image area ── */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center relative overflow-hidden"
        onWheel={handleWheel}
      >
        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center gap-3 text-white/70">
            <Loader2 className="w-8 h-8 animate-spin" />
            <span className="text-sm">{t("common.loading")}</span>
          </div>
        )}

        {/* Error */}
        {!loading && (error || images.every((img) => !img.src)) && (
          <div className="flex flex-col items-center gap-3 text-white/70">
            <AlertCircle className="w-8 h-8 text-error" />
            <span className="text-sm">{error || t("imageLightbox.loadFailed")}</span>
          </div>
        )}

        {/* Image */}
        {!loading && imageSrc && (
          <div
            className="relative select-none"
            style={{
              cursor:
                zoom > 1
                  ? isDragging
                    ? "grabbing"
                    : "grab"
                  : zoom < ZOOM_MAX
                    ? "zoom-in"
                    : "default",
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onDoubleClick={handleDoubleClick}
          >
            <img
              ref={imageRef}
              src={imageSrc}
              alt={
                imageName ||
                t("common.pastedImageAlt", { index: currentIndex + 1 })
              }
              className="max-w-[90vw] max-h-[80vh] object-contain"
              draggable={false}
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                transformOrigin: "center center",
                transition: isDragging
                  ? "none"
                  : "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}
            />
          </div>
        )}

        {/* Prev / Next arrows */}
        {!isSingle && !loading && (
          <>
            {currentIndex > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  goPrev();
                }}
                className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 hover:bg-black/60 dark:bg-black/50 dark:hover:bg-black/70 text-white transition-colors"
                aria-label={t("imageLightbox.prev")}
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
            )}
            {currentIndex < images.length - 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  goNext();
                }}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 hover:bg-black/60 dark:bg-black/50 dark:hover:bg-black/70 text-white transition-colors"
                aria-label={t("imageLightbox.next")}
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            )}
          </>
        )}

        {/* Overlay click to close hint (bottom area) */}
        <div
          className="absolute inset-x-0 bottom-0 h-16"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        />
      </div>

      {/* ── Bottom bar ── */}
      {!loading && imageSrc && (
        <div className="flex items-center justify-center gap-2 px-4 py-2 bg-black/60 dark:bg-black/70 backdrop-blur-md text-white select-none shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md hover:bg-white/10 dark:hover:bg-white/15 transition-colors text-sm"
            aria-label={t("imageLightbox.copy")}
          >
            <Copy className="w-4 h-4" />
            <span>
              {copyFeedback
                ? t("imageLightbox.copied")
                : t("imageLightbox.copy")}
            </span>
          </button>
          {hasFilePath && (
            <button
              type="button"
              onClick={handleOpenExternal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md hover:bg-white/10 dark:hover:bg-white/15 transition-colors text-sm"
              aria-label={t("imageLightbox.openExternal")}
            >
              <ExternalLink className="w-4 h-4" />
              <span>{t("imageLightbox.openExternal")}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
