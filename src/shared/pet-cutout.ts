/**
 * 桌宠图片的纯像素抠图：四角中位色 → 从边缘泛洪 → 软边 → 填小洞 → 质量闸门。
 *
 * 阈值与流程来自 eagent 的 frontend/src/features/pet-skin/cutout.mjs；
 * 只搬参数，不改阈值。纯函数、不碰 DOM，渲染层与 node 测试共用。
 */

export const PET_CUTOUT_LIMITS = {
  BG_TOL: 40,
  SOFT_TOL: 70,
  SOFT_RING_PX: 2,
  FILL_HOLE_MAX_PX: 256,
  ALPHA_MIN: 0.1,
  ALPHA_MAX: 0.85,
  OPAQUE_MIN: 0.04,
  BG_MIN_RATIO: 0.02,
} as const;

const PREEXISTING_ALPHA_MIN = 0.01;

export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface PixelBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CutoutResult {
  alpha: Uint8ClampedArray;
  bbox: PixelBBox | null;
  backgroundRatio: number;
}

export interface AlphaStats {
  transparentRatio: number;
  opaqueRatio: number;
  biggestHole: number;
}

export type PetCutoutFailure =
  | "too-small"
  | "no-subject"
  | "eaten-subject"
  | "holes";

export type PetCutoutGate =
  | { ok: true }
  | { ok: false; code: PetCutoutFailure };

export function hasUsableAlpha(data: Uint8ClampedArray): boolean {
  let partial = 0;
  const pixels = data.length / 4;
  for (let p = 0; p < pixels; p += 1) {
    if (data[p * 4 + 3] !== 255) partial += 1;
  }
  return pixels > 0 && partial / pixels >= PREEXISTING_ALPHA_MIN;
}

export function extractAlpha(data: Uint8ClampedArray): Uint8ClampedArray {
  const alpha = new Uint8ClampedArray(data.length / 4);
  for (let p = 0; p < alpha.length; p += 1) alpha[p] = data[p * 4 + 3];
  return alpha;
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function patchPicks(
  { data, width, height }: RgbaImage,
  px: number,
  py: number,
): Array<[number, number, number]> {
  const picks: Array<[number, number, number]> = [];
  for (let y = py; y < Math.min(py + 8, height); y += 1) {
    for (let x = px; x < Math.min(px + 8, width); x += 1) {
      const i = (y * width + x) * 4;
      picks.push([data[i], data[i + 1], data[i + 2]]);
    }
  }
  return picks;
}

function cornerPicks(image: RgbaImage): Array<Array<[number, number, number]>> {
  const { width, height } = image;
  return [
    [0, 0],
    [Math.max(0, width - 8), 0],
    [0, Math.max(0, height - 8)],
    [Math.max(0, width - 8), Math.max(0, height - 8)],
  ].map(([px, py]) => patchPicks(image, px, py));
}

function medianColor(
  picks: Array<[number, number, number]>,
): [number, number, number] {
  return [0, 1, 2].map((channel) =>
    median(picks.map((pixel) => pixel[channel])),
  ) as [number, number, number];
}

export function cornerBackground(image: RgbaImage): [number, number, number] {
  return medianColor(cornerPicks(image).flat());
}

function cornerBackgrounds(image: RgbaImage): Array<[number, number, number]> {
  return cornerPicks(image).map(medianColor);
}

/**
 * 四个角的背景色必须互相接近，才认为背景是纯色/近似纯色。
 * 渐变、天空、暗角、彩色噪点会让泛洪只清掉一条色带，留下半张背景；
 * 这种图必须直接回退原图，不能靠构图后的透明占比去兜底。
 */
export function isUniformBackground(image: RgbaImage): boolean {
  const patches = cornerBackgrounds(image);
  const [r0, g0, b0] = patches[0];
  return patches.every(
    ([r, g, b]) =>
      Math.hypot(r - r0, g - g0, b - b0) <= PET_CUTOUT_LIMITS.BG_TOL,
  );
}

function floodFromEdges(
  near: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const total = width * height;
  const background = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const push = (p: number) => {
    background[p] = 1;
    queue[tail] = p;
    tail += 1;
  };
  for (let x = 0; x < width; x += 1) {
    if (near[x] && !background[x]) push(x);
    const bottom = (height - 1) * width + x;
    if (near[bottom] && !background[bottom]) push(bottom);
  }
  for (let y = 0; y < height; y += 1) {
    const left = y * width;
    if (near[left] && !background[left]) push(left);
    const right = y * width + width - 1;
    if (near[right] && !background[right]) push(right);
  }
  while (head < tail) {
    const p = queue[head];
    head += 1;
    const x = p % width;
    const y = (p - x) / width;
    if (x > 0 && near[p - 1] && !background[p - 1]) push(p - 1);
    if (x < width - 1 && near[p + 1] && !background[p + 1]) push(p + 1);
    if (y > 0 && near[p - width] && !background[p - width]) push(p - width);
    if (y < height - 1 && near[p + width] && !background[p + width]) {
      push(p + width);
    }
  }
  return background;
}

function dilate(
  mask: Uint8Array,
  width: number,
  height: number,
  rounds: number,
): Uint8Array {
  let current = mask;
  for (let round = 0; round < rounds; round += 1) {
    const next = new Uint8Array(current);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const p = y * width + x;
        if (current[p]) continue;
        if (
          (x > 0 && current[p - 1]) ||
          (x < width - 1 && current[p + 1]) ||
          (y > 0 && current[p - width]) ||
          (y < height - 1 && current[p + width])
        ) {
          next[p] = 1;
        }
      }
    }
    current = next;
  }
  return current;
}

function fillSmallHoles(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  maxPx: number,
): void {
  const total = width * height;
  const seen = new Uint8Array(total);
  const queue = new Int32Array(total);
  for (let start = 0; start < total; start += 1) {
    if (alpha[start] !== 0 || seen[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
    seen[start] = 1;
    const points: number[] = [];
    let touchesEdge = false;
    while (head < tail) {
      const p = queue[head];
      head += 1;
      points.push(p);
      const x = p % width;
      const y = (p - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        touchesEdge = true;
      }
      const neighbours = [
        x > 0 ? p - 1 : -1,
        x < width - 1 ? p + 1 : -1,
        y > 0 ? p - width : -1,
        y < height - 1 ? p + width : -1,
      ];
      for (const q of neighbours) {
        if (q < 0 || alpha[q] !== 0 || seen[q]) continue;
        seen[q] = 1;
        queue[tail] = q;
        tail += 1;
      }
    }
    if (!touchesEdge && points.length <= maxPx) {
      for (const p of points) alpha[p] = 255;
    }
  }
}

export function opaqueBBox(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
): PixelBBox | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function biggestInteriorHole(
  transparentMask: Uint8Array,
  width: number,
  height: number,
): number {
  const total = width * height;
  const reached = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const push = (p: number) => {
    reached[p] = 1;
    queue[tail] = p;
    tail += 1;
  };
  for (let x = 0; x < width; x += 1) {
    if (transparentMask[x] && !reached[x]) push(x);
    const bottom = (height - 1) * width + x;
    if (transparentMask[bottom] && !reached[bottom]) push(bottom);
  }
  for (let y = 0; y < height; y += 1) {
    const left = y * width;
    if (transparentMask[left] && !reached[left]) push(left);
    const right = y * width + width - 1;
    if (transparentMask[right] && !reached[right]) push(right);
  }
  while (head < tail) {
    const p = queue[head];
    head += 1;
    const x = p % width;
    const y = (p - x) / width;
    const neighbours = [
      x > 0 ? p - 1 : -1,
      x < width - 1 ? p + 1 : -1,
      y > 0 ? p - width : -1,
      y < height - 1 ? p + width : -1,
    ];
    for (const q of neighbours) {
      if (q < 0 || !transparentMask[q] || reached[q]) continue;
      push(q);
    }
  }
  let biggest = 0;
  const seen = new Uint8Array(total);
  for (let start = 0; start < total; start += 1) {
    if (!transparentMask[start] || reached[start] || seen[start]) continue;
    let h = 0;
    let t = 0;
    queue[t] = start;
    t += 1;
    seen[start] = 1;
    let size = 0;
    while (h < t) {
      const p = queue[h];
      h += 1;
      size += 1;
      const x = p % width;
      const y = (p - x) / width;
      const neighbours = [
        x > 0 ? p - 1 : -1,
        x < width - 1 ? p + 1 : -1,
        y > 0 ? p - width : -1,
        y < height - 1 ? p + width : -1,
      ];
      for (const q of neighbours) {
        if (q < 0 || !transparentMask[q] || reached[q] || seen[q]) continue;
        seen[q] = 1;
        queue[t] = q;
        t += 1;
      }
    }
    if (size > biggest) biggest = size;
  }
  return biggest;
}

export function cutoutAlpha({ data, width, height }: RgbaImage): CutoutResult {
  const [refR, refG, refB] = cornerBackground({ data, width, height });
  const total = width * height;
  const near = new Uint8Array(total);
  const dist = new Float32Array(total);
  for (let p = 0; p < total; p += 1) {
    const i = p * 4;
    const d = Math.hypot(
      data[i] - refR,
      data[i + 1] - refG,
      data[i + 2] - refB,
    );
    dist[p] = d;
    near[p] = d < PET_CUTOUT_LIMITS.BG_TOL ? 1 : 0;
  }
  const background = floodFromEdges(near, width, height);
  const alpha = new Uint8ClampedArray(total);
  alpha.fill(255);
  for (let p = 0; p < total; p += 1) {
    if (background[p]) alpha[p] = 0;
  }

  const ring = dilate(
    background,
    width,
    height,
    PET_CUTOUT_LIMITS.SOFT_RING_PX,
  );
  const span = PET_CUTOUT_LIMITS.SOFT_TOL - PET_CUTOUT_LIMITS.BG_TOL;
  for (let p = 0; p < total; p += 1) {
    if (!ring[p] || background[p]) continue;
    if (dist[p] >= PET_CUTOUT_LIMITS.SOFT_TOL) continue;
    alpha[p] = Math.max(
      0,
      Math.min(255, ((dist[p] - PET_CUTOUT_LIMITS.BG_TOL) / span) * 255),
    );
  }

  fillSmallHoles(alpha, width, height, PET_CUTOUT_LIMITS.FILL_HOLE_MAX_PX);
  let backgroundCount = 0;
  for (let p = 0; p < total; p += 1) backgroundCount += background[p];
  return {
    alpha,
    bbox: opaqueBBox(alpha, width, height),
    backgroundRatio: total === 0 ? 0 : backgroundCount / total,
  };
}

export function alphaStats({ data, width, height }: RgbaImage): AlphaStats {
  const total = width * height;
  const transparentMask = new Uint8Array(total);
  let opaque = 0;
  for (let p = 0; p < total; p += 1) {
    if (data[p * 4 + 3] === 0) transparentMask[p] = 1;
    else opaque += 1;
  }
  let transparent = 0;
  for (let p = 0; p < total; p += 1) transparent += transparentMask[p];
  return {
    transparentRatio: total === 0 ? 1 : transparent / total,
    opaqueRatio: total === 0 ? 0 : opaque / total,
    biggestHole: biggestInteriorHole(transparentMask, width, height),
  };
}

export function evaluateGate({
  transparentRatio,
  opaqueRatio,
  biggestHole,
}: AlphaStats): PetCutoutGate {
  if (opaqueRatio < PET_CUTOUT_LIMITS.OPAQUE_MIN) {
    return { ok: false, code: "too-small" };
  }
  if (transparentRatio < PET_CUTOUT_LIMITS.ALPHA_MIN) {
    return { ok: false, code: "no-subject" };
  }
  if (transparentRatio > PET_CUTOUT_LIMITS.ALPHA_MAX) {
    return { ok: false, code: "eaten-subject" };
  }
  if (biggestHole > PET_CUTOUT_LIMITS.FILL_HOLE_MAX_PX) {
    return { ok: false, code: "holes" };
  }
  return { ok: true };
}
