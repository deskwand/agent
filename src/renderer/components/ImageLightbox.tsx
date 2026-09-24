import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useTranslation } from "react-i18next";
import { useBrowserOcclusion } from "../hooks/useBrowserOcclusion";
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
  useBrowserOcclusion(isOpen);

  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [copyFeedback, setCopyFeedback] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const dragSurfaceRef = useRef<HTMLDivElement>(null);
  const [toolbarAnchor, setToolbarAnchor] = useState<{
    left: number;
    top: number;
  } | null>(null);

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
  const imageSrc = currentImage?.src ?? "";
  const imageName = currentImage?.name ?? "";
  const hasFilePath = Boolean(currentImage?.filePath);

  // 工具条锚在图片「未变换」的布局盒右上角：transform 只挂在 img 上，不改变父级
  // 布局盒，所以拖拽面的盒子就是图片在 zoom === 1 时的可见边界，缩放与平移时不动。
  // 盒子还没尺寸（图片未解码）时给 null，让工具条退回预览区右上角。
  const measureToolbarAnchor = useCallback(() => {
    const box = dragSurfaceRef.current?.getBoundingClientRect();
    setToolbarAnchor(
      box && box.width > 0 && box.height > 0
        ? { left: box.right, top: box.top }
        : null,
    );
  }, []);

  // 重算时机：打开、loading 翻假、换图、窗口缩放。换图不另外依赖 currentIndex ——
  // 新图片的 onLoad 会再补一次测量。
  // 不用 ResizeObserver：jsdom 没实现它，会抛 ReferenceError 打挂既有测试。
  useLayoutEffect(() => {
    if (!isOpen) return;
    measureToolbarAnchor();
    window.addEventListener("resize", measureToolbarAnchor);
    return () => window.removeEventListener("resize", measureToolbarAnchor);
  }, [isOpen, loading, imageSrc, measureToolbarAnchor]);

  const canActOnImage = !loading && Boolean(imageSrc);
  // 图片已就绪但还没量到盒子（正在解码）时先不画工具条：否则它会先出现在预览区
  // 右上角 —— 正是用户嫌「太远」的那个位置 —— 再跳到图片角上。
  // 图片真的加载失败时 img 会走 alt 文本框（有尺寸），量到盒子后照常出现。
  const toolbarPendingMeasure = canActOnImage && !toolbarAnchor;
  // 工具条靠右锚定、向左生长，所以可用宽度由锚点的 x 决定；没有锚点时用视口宽度兜底。
  const toolbarMaxWidth = toolbarAnchor
    ? Math.max(160, toolbarAnchor.left - 12)
    : "calc(100vw - 1.5rem)";

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

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (zoom <= 1 || activePointerIdRef.current !== null) return;
      e.preventDefault();
      activePointerIdRef.current = e.pointerId;
      e.currentTarget.setPointerCapture(e.pointerId);
      setIsDragging(true);
      setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    },
    [zoom, offset],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging || e.pointerId !== activePointerIdRef.current) return;
      setOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    },
    [isDragging, dragStart],
  );

  const handlePointerEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerId !== activePointerIdRef.current) return;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      activePointerIdRef.current = null;
      setIsDragging(false);
    },
    [],
  );

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

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/50 dark:bg-black/80 flex flex-col"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* ── Image area ── */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center relative overflow-hidden"
        onWheel={handleWheel}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
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
            <span className="text-sm">
              {error || t("imageLightbox.loadFailed")}
            </span>
          </div>
        )}

        {/* Image */}
        {!loading && imageSrc && (
          <div
            ref={dragSurfaceRef}
            className="relative select-none"
            style={{
              touchAction: zoom > 1 ? "none" : "auto",
              cursor:
                zoom > 1
                  ? isDragging
                    ? "grabbing"
                    : "grab"
                  : zoom < ZOOM_MAX
                    ? "zoom-in"
                    : "default",
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
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
              onLoad={measureToolbarAnchor}
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
      </div>

      {/* ── Floating toolbar ── */}
      {/* 必须排在图片区**后面**：锚点和图片区都是 positioned、z-index:auto 的兄弟，
          CSS 按树序绘制，后面那个在上面。图片区铺满整个视口，工具条一旦排在它前面
          就会被盖住 —— 按钮点不到，点下去命中的是图片区，而图片区自己的 onClick
          会直接把弹层关掉。额外给一个 z-10 兜底，别让以后「清理无用类名」把这条
          隐形契约删掉。 */}
      {/* 放在图片区外面（不是图片区的后代）：滚轮、点击、拖拽就不会经过图片区的
          onWheel / onClick / onPointerDown，不需要任何 stopPropagation，也不会
          被图片区的 overflow-hidden 裁掉。 */}
      {/* 有图：锚在图片右上角上方 8px；没图（加载中 / 加载失败 / 图未解码）：
          退回预览区右上角内缩 12px。两种情况的水平关系都是「右边缘对齐锚点」。 */}
      <div
        className="absolute w-0 h-0"
        style={toolbarAnchor ?? { right: 12, top: 0 }}
      >
        <div
          data-testid="image-lightbox-toolbar"
          className={`${toolbarPendingMeasure ? "invisible " : ""}absolute right-0 ${
            toolbarAnchor ? "bottom-0 mb-2" : "top-0 mt-3"
          } z-10 flex items-center gap-1 p-1 rounded-lg bg-black/60 dark:bg-black/70 backdrop-blur-md border border-white/10 shadow-lg text-white select-none`}
          style={{ maxWidth: toolbarMaxWidth }}
        >
          {imageName && (
            <span className="min-w-0 truncate px-1.5 text-sm font-medium">
              {imageName}
            </span>
          )}
          {!isSingle && (
            <span className="shrink-0 text-xs text-white/60 dark:text-white/50">
              {t("imageLightbox.imageCount", {
                current: currentIndex + 1,
                total: images.length,
              })}
            </span>
          )}
          {zoom !== 1 && (
            <span className="shrink-0 text-xs text-white/40">
              {displayPercent}%
            </span>
          )}
          {canActOnImage && (Boolean(imageName) || !isSingle || zoom !== 1) && (
            <span className="shrink-0 w-px h-4 bg-white/20 mx-0.5" />
          )}
          {canActOnImage && (
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 flex items-center gap-1.5 h-8 px-2 rounded-md hover:bg-white/10 dark:hover:bg-white/15 transition-colors text-sm"
              aria-label={t("imageLightbox.copy")}
            >
              <Copy className="w-4 h-4" />
              <span>
                {copyFeedback
                  ? t("imageLightbox.copied")
                  : t("imageLightbox.copy")}
              </span>
            </button>
          )}
          {canActOnImage && hasFilePath && (
            <button
              type="button"
              onClick={handleOpenExternal}
              className="shrink-0 flex items-center gap-1.5 h-8 px-2 rounded-md hover:bg-white/10 dark:hover:bg-white/15 transition-colors text-sm"
              aria-label={t("imageLightbox.openExternal")}
            >
              <ExternalLink className="w-4 h-4" />
              <span>{t("imageLightbox.openExternal")}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 flex items-center justify-center h-8 w-8 rounded-md hover:bg-white/10 dark:hover:bg-white/15 transition-colors"
            aria-label={t("imageLightbox.close")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
