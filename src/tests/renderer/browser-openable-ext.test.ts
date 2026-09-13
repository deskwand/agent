import { describe, expect, it } from "vitest";
import { isBrowserOpenableExt } from "../../renderer/utils/file-preview";

describe("isBrowserOpenableExt", () => {
  it("accepts the nine browser-openable extensions", () => {
    for (const ext of [
      ".html",
      ".htm",
      ".pdf",
      ".mp3",
      ".wav",
      ".m4a",
      ".aac",
      ".ogg",
      ".flac",
    ]) {
      expect(isBrowserOpenableExt(ext)).toBe(true);
    }
  });

  it("requires a dotted lowercase extension", () => {
    expect(isBrowserOpenableExt("html")).toBe(false);
    expect(isBrowserOpenableExt(".HTML")).toBe(false);
    expect(isBrowserOpenableExt("")).toBe(false);
  });

  it("rejects preview-only and system-opened types", () => {
    for (const ext of [
      ".md",
      ".txt",
      ".json",
      ".png",
      ".svg",
      ".mp4",
      ".webm",
      ".mov",
      ".mkv",
      ".avi",
    ]) {
      expect(isBrowserOpenableExt(ext)).toBe(false);
    }
  });

  it("rejects Object.prototype member names", () => {
    expect(isBrowserOpenableExt(".constructor")).toBe(false);
    expect(isBrowserOpenableExt(".toString")).toBe(false);
  });
});
