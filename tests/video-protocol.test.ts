import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  createVideoSourceUrl,
  handleVideoRequest,
  parseVideoByteRange,
} from "../src/main/video-protocol";
import { buildLocalVideoUrl } from "../src/shared/video-file";

const tempDirs: string[] = [];

async function makeFile(name: string, content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "deskwand-video-"));
  tempDirs.push(dir);
  const filePath = join(dir, name);
  await writeFile(filePath, content);
  return filePath;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("parseVideoByteRange", () => {
  it("parses bounded, open-ended, and suffix ranges", () => {
    expect(parseVideoByteRange(null, 10)).toEqual({ kind: "full" });
    expect(parseVideoByteRange("bytes=2-5", 10)).toEqual({
      kind: "partial",
      start: 2,
      end: 5,
    });
    expect(parseVideoByteRange("bytes=7-", 10)).toEqual({
      kind: "partial",
      start: 7,
      end: 9,
    });
    expect(parseVideoByteRange("bytes=-3", 10)).toEqual({
      kind: "partial",
      start: 7,
      end: 9,
    });
  });

  it("rejects malformed and unsatisfiable ranges", () => {
    expect(parseVideoByteRange("bytes=20-30", 10)).toEqual({
      kind: "unsatisfiable",
    });
    expect(parseVideoByteRange("bytes=1-2,4-5", 10)).toEqual({
      kind: "unsatisfiable",
    });
  });
});

describe("handleVideoRequest", () => {
  it("streams a complete video", async () => {
    const filePath = await makeFile("clip.mp4", "0123456789");
    const response = await handleVideoRequest(
      new Request(createVideoSourceUrl(filePath)),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe("10");
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(await response.text()).toBe("0123456789");
  });

  it("streams only the requested byte range", async () => {
    const filePath = await makeFile("clip.webm", "0123456789");
    const response = await handleVideoRequest(
      new Request(createVideoSourceUrl(filePath), {
        headers: { Range: "bytes=2-5" },
      }),
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(response.headers.get("content-length")).toBe("4");
    expect(await response.text()).toBe("2345");
  });

  it("rejects invalid ranges and non-video files", async () => {
    const videoPath = await makeFile("clip.mp4", "0123456789");
    const invalidRange = await handleVideoRequest(
      new Request(createVideoSourceUrl(videoPath), {
        headers: { Range: "bytes=50-60" },
      }),
    );
    expect(invalidRange.status).toBe(416);
    expect(invalidRange.headers.get("content-range")).toBe("bytes */10");

    const textPath = await makeFile("notes.txt", "secret");
    const nonVideo = await handleVideoRequest(
      new Request(createVideoSourceUrl(textPath)),
    );
    expect(nonVideo.status).toBe(400);
  });

  it("rejects unsigned URLs from other web contents", async () => {
    const filePath = await makeFile("clip.mp4", "0123456789");
    const response = await handleVideoRequest(
      new Request(buildLocalVideoUrl(filePath, "invalid")),
    );
    expect(response.status).toBe(403);
  });

  it("returns 404 for a missing video and no body for HEAD", async () => {
    const missing = await handleVideoRequest(
      new Request(createVideoSourceUrl("/missing/clip.mp4")),
    );
    expect(missing.status).toBe(404);

    const filePath = await makeFile("clip.mp4", "0123456789");
    const head = await handleVideoRequest(
      new Request(createVideoSourceUrl(filePath), { method: "HEAD" }),
    );
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("10");
    expect(await head.text()).toBe("");
  });
});
