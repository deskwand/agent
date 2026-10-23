// @vitest-environment jsdom
import { ImageData as CanvasImageData, createCanvas, loadImage } from "canvas";
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyPetCutout } from "../../renderer/pet-cutout-apply";

const SIZE = 216;

function input(draw: (ctx: CanvasRenderingContext2D) => void): string {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, SIZE, SIZE);
  draw(ctx as unknown as CanvasRenderingContext2D);
  return canvas.toDataURL("image/png");
}

async function outputPixels(dataUrl: string): Promise<Uint8ClampedArray> {
  const image = await loadImage(Buffer.from(dataUrl.split(",")[1], "base64"));
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, SIZE, SIZE).data;
}

beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("ImageData", CanvasImageData);
  vi.stubGlobal("createImageBitmap", async (blob: Blob) => {
    const image = await loadImage(Buffer.from(await blob.arrayBuffer()));
    return Object.assign(image, { close: () => {} });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("applyPetCutout on a real canvas", () => {
  it("cuts a white background and centers the subject", async () => {
    const src = input((ctx) => {
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(60, 60, 96, 96);
    });
    const out = await applyPetCutout(src);
    expect(out).not.toBeNull();

    const pixels = await outputPixels(out!);
    expect(pixels[0 * 4 + 3]).toBe(0);
    expect(pixels[(108 * SIZE + 108) * 4 + 3]).toBe(255);
  });

  it("falls back on a gradient background", async () => {
    const src = input((ctx) => {
      const gradient = ctx.createLinearGradient(0, 0, SIZE, 0);
      gradient.addColorStop(0, "#ffffff");
      gradient.addColorStop(1, "#3366ff");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(80, 80, 56, 56);
    });
    await expect(applyPetCutout(src)).resolves.toBeNull();
  });

  it("keeps a pre-cut transparent hole instead of rejecting it", async () => {
    const canvas = createCanvas(SIZE, SIZE);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ff0000";
    ctx.beginPath();
    ctx.arc(108, 108, 90, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(108, 108, 40, 0, Math.PI * 2);
    ctx.fill();

    const out = await applyPetCutout(canvas.toDataURL("image/png"));
    expect(out).not.toBeNull();

    const pixels = await outputPixels(out!);
    expect(pixels[(108 * SIZE + 108) * 4 + 3]).toBe(0);
    expect(pixels[0 * 4 + 3]).toBe(0);
  });

  it("falls back on a tiny subject", async () => {
    const src = input((ctx) => {
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(100, 100, 2, 2);
    });
    await expect(applyPetCutout(src)).resolves.toBeNull();
  });
});
