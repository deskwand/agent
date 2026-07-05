/**
 * Unit tests for vision-describe tool.
 *
 * Covers: MIME detection, tool error branches, and tool factory.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { detectImageMimeType } from "../../main/agent/tools/vision-describe";

// ── Helpers ──

function writeMinimalImage(dir: string, name: string, header: number[]): string {
  const filePath = path.join(dir, name);
  const buf = Buffer.alloc(64, 0);
  for (let i = 0; i < header.length; i++) {
    buf[i] = header[i];
  }
  fs.writeFileSync(filePath, buf);
  return filePath;
}

// ── Tests ──

describe("vision-describe MIME detection", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskwand-vision-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("detects JPEG by header bytes", () => {
    const fp = writeMinimalImage(tempDir, "test.jpg", [0xff, 0xd8, 0xff]);
    expect(detectImageMimeType(fp)).toBe("image/jpeg");
  });

  it("detects PNG by header bytes", () => {
    const fp = writeMinimalImage(tempDir, "test.png", [0x89, 0x50, 0x4e, 0x47]);
    expect(detectImageMimeType(fp)).toBe("image/png");
  });

  it("detects GIF by header bytes", () => {
    const fp = writeMinimalImage(tempDir, "test.gif", [0x47, 0x49, 0x46, 0x38]);
    expect(detectImageMimeType(fp)).toBe("image/gif");
  });

  it("detects WebP by RIFF+WEBP header", () => {
    // RIFF....WEBP
    const buf = Buffer.alloc(64, 0);
    buf[0] = 0x52; // R
    buf[1] = 0x49; // I
    buf[2] = 0x46; // F
    buf[3] = 0x46; // F
    buf[8] = 0x57;  // W
    buf[9] = 0x45;  // E
    buf[10] = 0x42; // B
    buf[11] = 0x50; // P
    const fp = path.join(tempDir, "test.webp");
    fs.writeFileSync(fp, buf);
    expect(detectImageMimeType(fp)).toBe("image/webp");
  });

  it("detects BMP by header bytes", () => {
    const fp = writeMinimalImage(tempDir, "test.bmp", [0x42, 0x4d]);
    expect(detectImageMimeType(fp)).toBe("image/bmp");
  });

  it("detects SVG by content (xml)", () => {
    const fp = path.join(tempDir, "test.svg");
    fs.writeFileSync(fp, '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg">');
    expect(detectImageMimeType(fp)).toBe("image/svg+xml");
  });

  it("detects SVG by content (bare svg)", () => {
    const fp = path.join(tempDir, "test.svg");
    fs.writeFileSync(fp, '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>');
    expect(detectImageMimeType(fp)).toBe("image/svg+xml");
  });

  it("returns null for plain text file", () => {
    const fp = path.join(tempDir, "test.txt");
    fs.writeFileSync(fp, "Hello World");
    expect(detectImageMimeType(fp)).toBeNull();
  });

  it("returns null for json file", () => {
    const fp = path.join(tempDir, "test.json");
    fs.writeFileSync(fp, '{"key": "value"}');
    expect(detectImageMimeType(fp)).toBeNull();
  });

  it("returns null for non-existent file", () => {
    expect(detectImageMimeType("/nonexistent/file.xyz")).toBeNull();
  });
});

// ── Tool execute: error branches ──

describe("vision_describe tool execute — error branches", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskwand-vision-exec-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // Loads the real tool factory but with test isolation via temp dirs
  async function runExecute(params: { path: string }) {
    // Dynamic import to avoid module caching issues
    const { createVisionDescribeTool } = await import(
      "../../main/agent/tools/vision-describe"
    );
    const workspaceDir = process.cwd();
    const tool = createVisionDescribeTool({
      enabled: true,
      provider: "openai" as const,
      apiKey: "sk-test",
      model: "gpt-4o",
    }, workspaceDir);
    return tool.execute(
      "call-1",
      params,
      undefined, // no signal
      undefined, // no onUpdate
      {} as any,
    );
  }

  it("returns error when file does not exist", async () => {
    const result = await runExecute({
      path: path.join(tempDir, "nonexistent.png"),
    });
    expect((result.content[0] as { type: string; text?: string }).type).toBe("text");
    expect((result.content[0] as { type: string; text?: string }).text).toContain("Error: File not found");
  });

  it("returns error when path is a directory", async () => {
    const result = await runExecute({ path: tempDir });
    expect((result.content[0] as { type: string; text?: string }).type).toBe("text");
    expect((result.content[0] as { type: string; text?: string }).text).toContain("Error: Not a file");
  });

  it("returns error when file is not a recognized image", async () => {
    const txtPath = path.join(tempDir, "notes.txt");
    fs.writeFileSync(txtPath, "plain text");
    const result = await runExecute({ path: txtPath });
    expect((result.content[0] as { type: string; text?: string }).type).toBe("text");
    expect((result.content[0] as { type: string; text?: string }).text).toContain("Error: Not a recognized image format");
    expect((result.content[0] as { type: string; text?: string }).text).toContain("notes.txt");
  });

  it("returns error when image exceeds 20 MB limit", async () => {
    const bigPath = path.join(tempDir, "huge.png");
    // Write a PNG header + padding to exceed 20 MB
    const fd = fs.openSync(bigPath, "w");
    const header = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    fs.writeSync(fd, header);
    // Write 20 MB + 1 byte of padding
    const padding = Buffer.alloc(20 * 1024 * 1024 + 1, 0);
    fs.writeSync(fd, padding);
    fs.closeSync(fd);

    const result = await runExecute({ path: bigPath });
    expect((result.content[0] as { type: string; text?: string }).type).toBe("text");
    expect((result.content[0] as { type: string; text?: string }).text).toContain("Error: Image too large");
    expect((result.content[0] as { type: string; text?: string }).text).toContain("MB");
  });

  it("returns SVG content as plain text (no API call)", async () => {
    const svgPath = path.join(tempDir, "icon.svg");
    fs.writeFileSync(svgPath, '<svg><rect width="10" height="10"/></svg>');

    const result = await runExecute({ path: svgPath });
    expect((result.content[0] as { type: string; text?: string }).type).toBe("text");
    expect((result.content[0] as { type: string; text?: string }).text).toContain("[SVG Image");
    expect((result.content[0] as { type: string; text?: string }).text).toContain("<svg>");
  });

  it("accepts optional prompt parameter in params", async () => {
    const { createVisionDescribeTool } = await import(
      "../../main/agent/tools/vision-describe"
    );
    const pngPath = path.join(tempDir, "prompt-test.png");
    const buf = Buffer.alloc(64, 0);
    buf[0] = 0x89;
    buf[1] = 0x50;
    buf[2] = 0x4e;
    buf[3] = 0x47;
    fs.writeFileSync(pngPath, buf);

    const workspaceDir = process.cwd();
    const tool = createVisionDescribeTool({
      enabled: true,
      provider: "openai" as const,
      apiKey: "sk-test",
      model: "gpt-4o",
    }, workspaceDir);

    // Should not throw — prompt is optional, passes through to execute
    const result = await tool.execute(
      "call-prompt",
      { path: pngPath, prompt: "Extract only numeric values" },
      undefined,
      undefined,
      {} as any,
    );
    // Will fail at API call since key is fake, but should not be a schema error
    expect(result.content[0].type).toBe("text");
    const text = (result.content[0] as { type: string; text: string }).text;
    expect(text).not.toContain("Error: Not a recognized image format");
    expect(text).not.toContain("Error: File not found");
  });

  it("sends custom prompt to vision API when provided", async () => {
    const { createVisionDescribeTool } = await import(
      "../../main/agent/tools/vision-describe"
    );
    const pngPath = path.join(tempDir, "prompt-send-test.png");
    const buf = Buffer.alloc(64, 0);
    buf[0] = 0x89;
    buf[1] = 0x50;
    buf[2] = 0x4e;
    buf[3] = 0x47;
    fs.writeFileSync(pngPath, buf);

    const customPrompt = "Extract only Chinese characters";
    let capturedBody: string | null = null;
    const originalFetch = global.fetch;
    global.fetch = ((_url: string, init: RequestInit) => {
      capturedBody = (init as { body?: string }).body || null;
      // Return ok response with fake content so the tool doesn't error out
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Fake: extracted Chinese" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }) as typeof global.fetch;

    try {
      const tool = createVisionDescribeTool(
        {
          enabled: true,
          provider: "openai" as const,
          apiKey: "sk-test",
          model: "gpt-4o",
        },
        process.cwd(),
      );

      const result = await tool.execute(
        "call-send-prompt",
        { path: pngPath, prompt: customPrompt },
        undefined,
        undefined,
        {} as any,
      );
      expect(result.content[0].type).toBe("text");
      // Verify the custom prompt was sent in the API request body
      expect(capturedBody).not.toBeNull();
      expect(capturedBody!).toContain(customPrompt);
      expect(capturedBody!).not.toContain("Please describe this image in detail");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("treats empty string prompt same as no prompt", async () => {
    const { createVisionDescribeTool } = await import(
      "../../main/agent/tools/vision-describe"
    );
    const pngPath = path.join(tempDir, "empty-prompt-test.png");
    const buf = Buffer.alloc(64, 0);
    buf[0] = 0x89;
    buf[1] = 0x50;
    buf[2] = 0x4e;
    buf[3] = 0x47;
    fs.writeFileSync(pngPath, buf);

    const workspaceDir = process.cwd();
    const tool = createVisionDescribeTool({
      enabled: true,
      provider: "openai" as const,
      apiKey: "sk-test",
      model: "gpt-4o",
    }, workspaceDir);

    // With empty prompt — should not throw or reject the parameter
    const result = await tool.execute(
      "call-empty-prompt",
      { path: pngPath, prompt: "" },
      undefined,
      undefined,
      {} as any,
    );
    expect(result.content[0].type).toBe("text");
    const text = (result.content[0] as { type: string; text: string }).text;
    expect(text).not.toContain("Error: Not a recognized image format");
    expect(text).not.toContain("Error: File not found");
  });

  it("handles relative paths by resolving against cwd", async () => {
    // Write a known image to cwd and test relative path
    const pngPath = path.join(process.cwd(), "test-relative-vision.png");
    const buf = Buffer.alloc(64, 0);
    buf[0] = 0x89;
    buf[1] = 0x50;
    buf[2] = 0x4e;
    buf[3] = 0x47;
    fs.writeFileSync(pngPath, buf);

    try {
      const { createVisionDescribeTool } = await import(
        "../../main/agent/tools/vision-describe"
      );
      const workspaceDir = process.cwd();
      const tool = createVisionDescribeTool({
        enabled: true,
        provider: "openai" as const,
        apiKey: "sk-test",
        model: "gpt-4o",
      }, workspaceDir);
      const result = await tool.execute(
        "call-rel",
        { path: "test-relative-vision.png" },
        undefined,
        undefined,
        {} as any,
      );
      // Should either reach the API (fail), or for small PNG recognize it
      // and attempt the API call — either way, not a "file not found" error
      expect((result.content[0] as { type: string; text?: string }).text).not.toContain("Error: File not found");
    } finally {
      try {
        fs.unlinkSync(pngPath);
      } catch {
        // cleanup best-effort
      }
    }
  });
});
