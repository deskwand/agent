import { describe, expect, it } from "vitest";
import { pickReleaseNotes } from "../../renderer/utils/release-notes";

const RAW = JSON.stringify({ zh: "中文摘要", en: "English summary" });

describe("pickReleaseNotes", () => {
  it("picks the matching language", () => {
    expect(pickReleaseNotes(RAW, "zh")).toBe("中文摘要");
    expect(pickReleaseNotes(RAW, "en")).toBe("English summary");
  });

  it("treats any zh-* locale as Chinese and everything else as English", () => {
    expect(pickReleaseNotes(RAW, "zh-CN")).toBe("中文摘要");
    expect(pickReleaseNotes(RAW, "zh-Hant")).toBe("中文摘要");
    expect(pickReleaseNotes(RAW, "ZH")).toBe("中文摘要");
    expect(pickReleaseNotes(RAW, "en-US")).toBe("English summary");
    expect(pickReleaseNotes(RAW, "ja")).toBe("English summary");
  });

  it("returns null when the requested language is missing or blank", () => {
    const enOnly = JSON.stringify({ zh: "只有中文", en: "  " });
    expect(pickReleaseNotes(enOnly, "en")).toBeNull();
    expect(
      pickReleaseNotes(JSON.stringify({ zh: "只有中文" }), "en"),
    ).toBeNull();
  });

  it("returns null for unusable input instead of throwing", () => {
    expect(pickReleaseNotes(null, "zh")).toBeNull();
    expect(pickReleaseNotes(undefined, "zh")).toBeNull();
    expect(pickReleaseNotes("", "zh")).toBeNull();
    expect(pickReleaseNotes("   ", "zh")).toBeNull();
    expect(pickReleaseNotes("{oops", "zh")).toBeNull();
    expect(pickReleaseNotes('["zh","en"]', "zh")).toBeNull();
    expect(pickReleaseNotes('"plain string"', "zh")).toBeNull();
    expect(
      pickReleaseNotes(JSON.stringify({ zh: 42, en: [] }), "zh"),
    ).toBeNull();
  });
});
