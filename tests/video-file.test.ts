import { describe, expect, it } from "vitest";
import {
  buildLocalVideoUrl,
  getVideoMimeType,
  getVideoPlaybackKind,
  isKnownVideoFile,
} from "../src/shared/video-file";

describe("video file classification", () => {
  it("classifies inline and external-only containers case-insensitively", () => {
    expect(getVideoPlaybackKind("clip.mp4")).toBe("inline");
    expect(getVideoPlaybackKind("CLIP.WEBM")).toBe("inline");
    expect(getVideoPlaybackKind("clip.mov")).toBe("external");
    expect(getVideoPlaybackKind("clip.MKV")).toBe("external");
    expect(getVideoPlaybackKind("notes.txt")).toBe("none");
  });

  it("uses video MIME only as an external fallback for unknown extensions", () => {
    expect(getVideoPlaybackKind("clip", "video/mp4")).toBe("external");
    expect(getVideoPlaybackKind("clip.bin", "video/webm")).toBe("external");
    expect(getVideoPlaybackKind("clip", "application/octet-stream")).toBe(
      "none",
    );
  });

  it("exposes protocol validation and MIME helpers", () => {
    expect(isKnownVideoFile("clip.m4v")).toBe(true);
    expect(isKnownVideoFile("clip.exe")).toBe(false);
    expect(getVideoMimeType("clip.mp4")).toBe("video/mp4");
    expect(getVideoMimeType("clip.webm")).toBe("video/webm");
    expect(getVideoMimeType("clip.mkv")).toBe("video/x-matroska");
  });
});

describe("buildLocalVideoUrl", () => {
  it.each([
    "/tmp/My Clip #1%.mp4",
    "/tmp/中文视频.mp4",
    "C:\\Users\\Test User\\clip.mp4",
    "\\\\server\\share\\clip.webm",
  ])("round-trips %s through the encoded query", (filePath) => {
    const url = new URL(buildLocalVideoUrl(filePath, "signed-value"));
    expect(url.protocol).toBe("deskwand-media:");
    expect(url.hostname).toBe("local");
    expect(url.searchParams.get("path")).toBe(filePath);
    expect(url.searchParams.get("signature")).toBe("signed-value");
  });
});
