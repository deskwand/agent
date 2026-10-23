import {
  PET_CUTOUT_LIMITS,
  alphaStats,
  cutoutAlpha,
  evaluateGate,
  extractAlpha,
  hasUsableAlpha,
  isUniformBackground,
  opaqueBBox,
  type PixelBBox,
} from "../shared/pet-cutout";

const MAX_SOURCE_SIDE = 1024;
const CANVAS_SIZE = 216;
const SUBJECT_RATIO = 0.92;

export interface CompositionRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/** 把主体 bbox 按长边铺到画布的 92%，居中。纯算术，单测覆盖。 */
export function compositionRect(
  bbox: PixelBBox,
  canvasSize = CANVAS_SIZE,
  subjectRatio = SUBJECT_RATIO,
): CompositionRect {
  const scale = (canvasSize * subjectRatio) / Math.max(bbox.w, bbox.h);
  const dw = Math.max(1, Math.round(bbox.w * scale));
  const dh = Math.max(1, Math.round(bbox.h * scale));
  return {
    sx: bbox.x,
    sy: bbox.y,
    sw: bbox.w,
    sh: bbox.h,
    dx: Math.round((canvasSize - dw) / 2),
    dy: Math.round((canvasSize - dh) / 2),
    dw,
    dh,
  };
}

export function isPetCutoutCandidate(src: string): boolean {
  return /^data:image\/png[;,]/.test(src);
}

export function decodeDataUrl(
  src: string,
): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(src);
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { mime: match[1], bytes };
  } catch {
    return null;
  }
}

export function applyPetCutout(src: string): Promise<string | null> {
  if (!isPetCutoutCandidate(src)) return Promise.resolve(null);
  return runPetCutout(src).catch(() => null);
}

async function runPetCutout(src: string): Promise<string | null> {
  if (typeof createImageBitmap !== "function") return null;
  const decoded = decodeDataUrl(src);
  if (!decoded) return null;

  const bitmap = await createImageBitmap(
    // TS 5.9 的 BlobPart 只接受 ArrayBuffer 支持的视图；bytes 是新分配的连续缓冲。
    new Blob([decoded.bytes.buffer as ArrayBuffer], { type: decoded.mime }),
  );
  try {
    const scale = Math.min(
      1,
      MAX_SOURCE_SIDE / Math.max(bitmap.width, bitmap.height),
    );
    const sourceW = Math.max(1, Math.round(bitmap.width * scale));
    const sourceH = Math.max(1, Math.round(bitmap.height * scale));

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = sourceW;
    sourceCanvas.height = sourceH;
    const sourceCtx = sourceCanvas.getContext("2d");
    if (!sourceCtx) return null;
    sourceCtx.imageSmoothingQuality = "high";
    sourceCtx.drawImage(bitmap, 0, 0, sourceW, sourceH);
    const source = sourceCtx.getImageData(0, 0, sourceW, sourceH);

    const preCut = hasUsableAlpha(source.data);
    let alpha: Uint8ClampedArray;
    if (preCut) {
      alpha = extractAlpha(source.data);
    } else {
      // 渐变/暗角会让泛洪只清掉一条色带；四角颜色不一致就整张回退。
      if (!isUniformBackground(source)) return null;
      const cut = cutoutAlpha(source);
      if (cut.backgroundRatio < PET_CUTOUT_LIMITS.BG_MIN_RATIO) return null;
      alpha = cut.alpha;
    }

    const bbox = opaqueBBox(alpha, sourceW, sourceH);
    // 构图会把 bbox 放大到 92%，所以 2×2 的噪点也能填满整张画布；先按源尺寸拒绝。
    if (!bbox || Math.max(bbox.w, bbox.h) < 8) return null;

    const composed = new ImageData(
      new Uint8ClampedArray(source.data),
      sourceW,
      sourceH,
    );
    for (let p = 0; p < alpha.length; p += 1) {
      composed.data[p * 4 + 3] = alpha[p];
    }
    const fullCanvas = document.createElement("canvas");
    fullCanvas.width = sourceW;
    fullCanvas.height = sourceH;
    const fullCtx = fullCanvas.getContext("2d");
    if (!fullCtx) return null;
    fullCtx.putImageData(composed, 0, 0);

    const targetCanvas = document.createElement("canvas");
    targetCanvas.width = CANVAS_SIZE;
    targetCanvas.height = CANVAS_SIZE;
    const targetCtx = targetCanvas.getContext("2d");
    if (!targetCtx) return null;
    targetCtx.imageSmoothingQuality = "high";

    const rect = compositionRect(bbox);
    targetCtx.drawImage(
      fullCanvas,
      rect.sx,
      rect.sy,
      rect.sw,
      rect.sh,
      rect.dx,
      rect.dy,
      rect.dw,
      rect.dh,
    );

    // 预抠图的透明洞是用户自己的，holes/透明占比闸门不适用；只对泛洪结果做检查。
    if (!preCut) {
      const stats = alphaStats(
        targetCtx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE),
      );
      if (!evaluateGate(stats).ok) return null;
    }
    return targetCanvas.toDataURL("image/png");
  } finally {
    bitmap.close?.();
  }
}
