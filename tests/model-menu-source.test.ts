import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const chipPath = path.resolve(
  process.cwd(),
  "src/renderer/components/MergedInputChip.tsx",
);

describe("Model menu single-panel layout", () => {
  const source = fs.readFileSync(chipPath, "utf8");

  it("uses a single panel with three views", () => {
    expect(source).toContain('"modes" | "custom" | "thinking"');
  });

  it("has no magic-offset positioning or legacy submenu state", () => {
    expect(source).not.toContain("right-[calc(15rem");
    expect(source).not.toContain("right-[calc(30rem");
    expect(source).not.toContain("activeSubmenu");
    expect(source).not.toContain("primaryMenuRef");
  });

  it("custom entry toggles by click only", () => {
    const idx = source.indexOf("modelMenu.custom");
    const customBlock = source.slice(idx - 400, idx + 200);
    expect(customBlock).toContain("onClick");
    expect(customBlock).not.toContain("onMouseEnter");
  });

  it("renders thinking row in custom and non-cloud views", () => {
    expect(source).toContain('panelView === "custom"');
    expect(source).toContain("chat.thinkingLevel");
  });
});

describe("Thinking level is user-controlled, not mode-locked", () => {
  it("ChatView keeps the user's thinking level when switching models", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/renderer/components/ChatView.tsx"),
      "utf8",
    );
    expect(source).toContain("thinkingLevel");
    // 选模型不再按预设模式改写思考档：cloudConfig 在该组件已不再使用
    expect(source).not.toContain("cloudConfig");
  });

  it("WelcomeView keeps the user's thinking level when switching models", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/renderer/components/WelcomeView.tsx"),
      "utf8",
    );
    expect(source).toContain("thinkingLevel");
    expect(source).not.toContain("cloudConfig");
  });
});
