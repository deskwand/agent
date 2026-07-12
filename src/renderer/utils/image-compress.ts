const MAX_DIM = 1568;
const JPEG_QUALITY = 0.85;
const MAX_BLOB_SIZE = 3.75 * 1024 * 1024; // 3.75 MB

// ---- Public API ----

/**
 * Resize and compress an image blob before sending to an LLM.
 * - Scales down to max 1568px on the longest side
 * - Converts to JPEG at quality 0.85 regardless of input format
 * - Falls back to iterative quality/scale reduction if still > 3.75MB
 * - GIF and SVG pass through unchanged
 */
export async function compressImageForLLM(blob: Blob): Promise<Blob> {
  if (!shouldProcessImage(blob.type)) return blob;

  const img = await loadImageFromBlob(blob);
  const { width, height } = computeTargetDimensions(
    img.naturalWidth,
    img.naturalHeight,
    MAX_DIM,
  );

  const jpegBlob = await renderToBlob(
    img,
    width,
    height,
    "image/jpeg",
    JPEG_QUALITY,
  );

  if (jpegBlob.size <= MAX_BLOB_SIZE) return jpegBlob;

  return iterativeCompress(img, width, height, MAX_BLOB_SIZE);
}

// ---- Pure helpers (exported for testing) ----

/** Decide whether an image type should be processed (not GIF/SVG/non-image). */
export function shouldProcessImage(type: string): boolean {
  if (!type.startsWith("image/")) return false;
  if (type === "image/gif" || type === "image/svg+xml") return false;
  return true;
}

/** Compute target dimensions after applying the max-dimension constraint. */
export function computeTargetDimensions(
  naturalWidth: number,
  naturalHeight: number,
  maxDim: number,
): { width: number; height: number } {
  const longestSide = Math.max(naturalWidth, naturalHeight);
  if (longestSide <= maxDim) {
    return { width: naturalWidth, height: naturalHeight };
  }
  const scale = maxDim / longestSide;
  return {
    width: Math.round(naturalWidth * scale),
    height: Math.round(naturalHeight * scale),
  };
}

// ---- Browser glue (not testable in jsdom without mocks) ----

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image from blob"));
    };
    img.src = url;
  });
}

function renderToBlob(
  img: HTMLImageElement,
  width: number,
  height: number,
  type: string,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2d context");
  ctx.drawImage(img, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("canvas.toBlob returned null"));
        else resolve(blob);
      },
      type,
      quality,
    );
  });
}

function iterativeCompress(
  img: HTMLImageElement,
  baseWidth: number,
  baseHeight: number,
  maxSize: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2d context");

  const attempt = (scale: number, quality: number): Promise<Blob> => {
    const w = Math.round(baseWidth * scale);
    const h = Math.round(baseHeight * scale);
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error("canvas.toBlob returned null"));
          if (blob.size > maxSize && (quality > 0.5 || scale > 0.3)) {
            const nextQuality = Math.max(0.5, quality - 0.1);
            const nextScale = quality <= 0.5 ? scale * 0.9 : scale;
            attempt(nextScale, nextQuality).then(resolve).catch(reject);
          } else {
            resolve(blob);
          }
        },
        "image/jpeg",
        quality,
      );
    });
  };

  return attempt(1.0, JPEG_QUALITY);
}
