import { describe, expect, it } from "vitest";
import { extractVideoReferences } from "../src/renderer/utils/video-reference";

describe("extractVideoReferences", () => {
  it.each([
    ["absolute path", "open /repo/output/clip.mp4", "/repo/output/clip.mp4"],
    [
      "hidden directory",
      "open /Users/demo/.deskwand/default_working_dir/clip.mp4",
      "/Users/demo/.deskwand/default_working_dir/clip.mp4",
    ],
    ["relative path", "open ./output/clip.webm", "/repo/output/clip.webm"],
    ["bare filename", "created clip.mp4", "/repo/clip.mp4"],
    ["Windows path", "open C:\\Videos\\clip.mp4", "C:\\Videos\\clip.mp4"],
    [
      "UNC path",
      "open \\\\server\\share\\clip.mp4",
      "\\\\server\\share\\clip.mp4",
    ],
    [
      "workspace alias",
      "open /workspace/output/clip.mp4",
      "/repo/output/clip.mp4",
    ],
    ["uppercase extension", "open ./CLIP.MP4", "/repo/CLIP.MP4"],
    ["Chinese filename", "open ./输出视频.mp4", "/repo/输出视频.mp4"],
    ["trailing punctuation", "created ./clip.mp4。", "/repo/clip.mp4"],
    ["markdown link", "[watch](./output/clip.mp4)", "/repo/output/clip.mp4"],
    [
      "fenced command",
      '```bash\nopen "/repo/My Video/clip.mp4"\n```',
      "/repo/My Video/clip.mp4",
    ],
  ])("extracts %s", (_label, markdown, expectedPath) => {
    expect(extractVideoReferences(markdown, "/repo")).toContainEqual(
      expect.objectContaining({ path: expectedPath }),
    );
  });

  it("classifies external-only containers", () => {
    expect(extractVideoReferences("open output/clip.mov", "/repo")).toEqual([
      {
        path: "/repo/output/clip.mov",
        name: "clip.mov",
        playbackKind: "external",
      },
    ]);
  });

  it("deduplicates resolved paths", () => {
    const result = extractVideoReferences(
      "clip.mp4 and ./clip.mp4 and [watch](clip.mp4)",
      "/repo",
    );
    expect(result).toHaveLength(1);
  });

  it.each([
    "https://example.com/clip.mp4",
    "[clip.mp4](https://example.com/clip.mp4)",
    "![clip.mp4](https://example.com/poster.jpg)",
    "mailto:clip.mp4@example.com",
    "notes.txt",
  ])("ignores %s", (markdown) => {
    expect(extractVideoReferences(markdown, "/repo")).toEqual([]);
  });

  it("ignores a relative path without a workspace", () => {
    expect(extractVideoReferences("output/clip.mp4")).toEqual([]);
  });
});
