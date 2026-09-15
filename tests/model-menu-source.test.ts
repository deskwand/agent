import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const chipPath = path.resolve(
  process.cwd(),
  "src/renderer/components/MergedInputChip.tsx",
);

describe("Model menu single-panel layout", () => {
  const source = fs.readFileSync(chipPath, "utf8");

  it("uses a single panel with two views", () => {
    expect(source).toContain('"list" | "thinking"');
  });

  it("has no magic-offset positioning or legacy submenu state", () => {
    expect(source).not.toContain("right-[calc(15rem");
    expect(source).not.toContain("right-[calc(30rem");
    expect(source).not.toContain("activeSubmenu");
    expect(source).not.toContain("primaryMenuRef");
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
