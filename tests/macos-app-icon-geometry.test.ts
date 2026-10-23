import { readFileSync } from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "canvas";
import { describe, expect, it } from "vitest";

// macOS 26 (Tahoe) 起，系统会把 .icns 里的图案塞进自己的 squircle 容器：
// 只要图案不是"居中的正方形"、或碰到了画布边缘，就会被判为不合规 ——
// 系统把它缩小到约 83% 并垫一层浅色玻璃底板（社区叫 icon jail / white plate）。
// 2026-10 系统升级后 Dock 里的图标就是这副样子：黑色方形缩在浅灰圆角底板中间。
// 合规的几何是 1024 画布 + 824×824 居中内容（80.5%，与系统图标网格一致），
// 这也是 macOS 11–15 的标准网格，旧系统上显示同样正常。
const RESOURCES = path.resolve(import.meta.dirname, "../resources");
const ICNS_PATH = path.join(RESOURCES, "icon.icns");
const ICONSET_1024 = path.join(RESOURCES, "icon.iconset/icon_512x512@2x.png");
const CANVAS = 1024;
const CONTENT_RATIO = 824 / CANVAS;
const ALPHA_THRESHOLD = 128;
// 预留余量：不同重采样算法会让内容边缘浮动几个像素。
const MAX_ASPECT_DRIFT = 0.03;
const RATIO_TOLERANCE = 0.02;
const MAX_CENTER_DRIFT = 0.015;

interface IcnsEntry {
  type: string;
  size: number;
  data: Buffer;
}

/** 图案（alpha ≥ 阈值）在画布里的包围盒。 */
interface AlphaBox {
  width: number;
  height: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** icns 是容器格式：8 字节文件头 + 若干 [4 字节类型][4 字节长度含头][数据]。 */
function readIcnsEntries(buffer: Buffer): IcnsEntry[] {
  const entries: IcnsEntry[] = [];
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString("latin1", offset, offset + 4);
    const length = buffer.readUInt32BE(offset + 4);
    if (length < 8 || offset + length > buffer.length) break;
    entries.push({
      type,
      size: length - 8,
      data: buffer.subarray(offset + 8, offset + length),
    });
    offset += length;
  }
  return entries;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 取 icns 里体积最大的 PNG 表达（1024 的 ic10），这是系统首选的那一份。 */
function largestPngEntry(entries: IcnsEntry[]): IcnsEntry {
  const pngEntries = entries.filter(
    (entry) =>
      entry.size > PNG_MAGIC.length &&
      entry.data.subarray(0, 8).equals(PNG_MAGIC),
  );
  expect(
    pngEntries.length,
    "icon.icns 应当包含 PNG 类型的图标表达",
  ).toBeGreaterThan(0);
  return pngEntries.reduce((largest, entry) =>
    entry.size > largest.size ? entry : largest,
  );
}

async function measureAlphaBBox(buffer: Buffer): Promise<AlphaBox> {
  const image = await loadImage(buffer);
  const width = image.width;
  const height = image.height;
  const ctx = createCanvas(width, height).getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  expect(maxX, "图标不应是空图").toBeGreaterThanOrEqual(0);
  return { width, height, minX, minY, maxX, maxY };
}

function expectSquircleSafe(box: AlphaBox, label: string) {
  const width = box.maxX - box.minX + 1;
  const height = box.maxY - box.minY + 1;
  const canvas = box.width;

  // 1) 图案必须近似正方形 —— 非正方形会被判为不合规并垫底板。
  expect(
    Math.abs(width - height) / width,
    `${label} 的图案宽高比必须接近 1:1（当前 ${width}×${height}）`,
  ).toBeLessThanOrEqual(MAX_ASPECT_DRIFT);

  // 2) 图案必须留在画布内、且约为画布的 80.5%（贴边同样会被判为不合规）。
  const ratio = width / canvas;
  expect(
    Math.abs(ratio - CONTENT_RATIO),
    `${label} 的图案应占画布约 ${(CONTENT_RATIO * 100).toFixed(1)}%（当前 ${(ratio * 100).toFixed(1)}%）`,
  ).toBeLessThanOrEqual(RATIO_TOLERANCE);

  // 3) 居中：偏移过大同样是"非标准图标"。
  const centerX = (box.minX + box.maxX) / 2;
  const centerY = (box.minY + box.maxY) / 2;
  const half = canvas / 2;
  expect(
    Math.abs(centerX - half) / canvas,
    `${label} 图案需水平居中`,
  ).toBeLessThanOrEqual(MAX_CENTER_DRIFT);
  expect(
    Math.abs(centerY - half) / canvas,
    `${label} 图案需垂直居中`,
  ).toBeLessThanOrEqual(MAX_CENTER_DRIFT);
}

describe("macOS app icon geometry", () => {
  it("icon.icns 的图案在系统 squircle 容器里不会被关进 icon jail", async () => {
    const entries = readIcnsEntries(readFileSync(ICNS_PATH));
    const largest = largestPngEntry(entries);

    const box = await measureAlphaBBox(largest.data);

    expect(box.width, "最大的一份 PNG 表达应当是 1024×1024").toBe(CANVAS);
    expect(box.height).toBe(CANVAS);
    expectSquircleSafe(box, "icon.icns");
  });

  it("icon.iconset 的 1024 源图与 icns 保持同样的几何", async () => {
    const box = await measureAlphaBBox(readFileSync(ICONSET_1024));

    expect(box.width).toBe(CANVAS);
    expect(box.height).toBe(CANVAS);
    expectSquircleSafe(box, "icon.iconset/icon_512x512@2x.png");
  });
});
