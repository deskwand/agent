import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const chipPath = path.resolve(
  process.cwd(),
  "src/renderer/components/MergedInputChip.tsx",
);

describe("Model menu login-state layout", () => {
  const source = fs.readFileSync(chipPath, "utf8");

  it("splits cloud group from custom providers", () => {
    expect(source).toContain('profileKey === "custom:deskwand"');
    expect(source).toContain("panelView");
  });

  it("hides thinking row and chip level in cloud mode", () => {
    expect(source).toContain("!isCloudMode");
  });

  it("renders custom entry and back row", () => {
    expect(source).toContain("modelMenu.custom");
    expect(source).toContain("modelMenu.back");
  });
});

describe("Mode selection syncs session thinking", () => {
  it("ChatView syncs thinking from mode config", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/renderer/components/ChatView.tsx"),
      "utf8",
    );
    expect(source).toContain("thinkingLevel");
    expect(source).toContain('"custom:deskwand"');
  });

  it("WelcomeView syncs thinking from mode config", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/renderer/components/WelcomeView.tsx"),
      "utf8",
    );
    expect(source).toContain("thinkingLevel");
    expect(source).toContain('"custom:deskwand"');
  });
});
