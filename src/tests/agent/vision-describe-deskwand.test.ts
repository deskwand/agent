import { describe, it, expect, vi, afterEach } from "vitest";
import { createDeskWandVisionTool } from "../../main/agent/tools/vision-describe";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// 1x1 透明 PNG
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function tempPng(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vision-test-"));
  const file = path.join(dir, "x.png");
  fs.writeFileSync(file, Buffer.from(PNG_BASE64, "base64"));
  return file;
}

describe("createDeskWandVisionTool", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function runTool(filePath: string, prompt?: string) {
    const tool = createDeskWandVisionTool(
      "https://api.deskwand.com/",
      "tok-123",
      os.tmpdir(),
    );
    const fn = (
      tool as unknown as { execute: (...args: unknown[]) => Promise<unknown> }
    ).execute;
    return fn(
      undefined,
      { path: filePath, prompt },
      undefined,
      undefined,
      undefined,
    );
  }

  it("posts image to the server vision endpoint with bearer token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ text: "a cat" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const file = tempPng();
    const result = (await runTool(file)) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result.content[0].text).toBe("a cat");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.deskwand.com/vision");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok-123",
    );
    const body = JSON.parse(String(init.body)) as {
      image: string;
      mimeType: string;
    };
    expect(body.mimeType).toBe("image/png");
    expect(body.image).toBeTruthy();
  });

  it("maps 402 to a top-up message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "x" } }), {
          status: 402,
        }),
      ),
    );
    const file = tempPng();
    const result = (await runTool(file)) as {
      content: Array<{ type: string; text: string }>;
    };
    expect(result.content[0].text).toContain(
      "Insufficient balance, please top up to continue.",
    );
  });

  it("passes through upstream error message on 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "upstream boom" } }), {
          status: 500,
        }),
      ),
    );
    const file = tempPng();
    const result = (await runTool(file)) as {
      content: Array<{ type: string; text: string }>;
    };
    expect(result.content[0].text).toContain("upstream boom");
  });
});
