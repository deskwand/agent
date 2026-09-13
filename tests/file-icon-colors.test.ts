import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const stylesPath = path.resolve(
  process.cwd(),
  "src/renderer/styles/globals.css",
);

const source = fs.readFileSync(stylesPath, "utf8");

// 基础深色档就是第一个 :root 块，浅色档是紧随其后的 .light 块。
// 两者都不可能出现在任何主题预设块里——预设块只覆盖自己的变量集。
const lightStart = source.indexOf("\n  .light {");
const presetStart = source.indexOf('data-theme-preset="paper"');
const darkBlock = source.slice(0, lightStart);
const lightBlock = source.slice(lightStart, presetStart);

const TOKENS = ["folder", "media", "doc", "code", "audio", "neutral"] as const;

describe("file icon colour tokens", () => {
  it("declares every token in the dark base block and the light block", () => {
    for (const token of TOKENS) {
      expect(darkBlock).toContain(`--color-file-${token}:`);
      expect(lightBlock).toContain(`--color-file-${token}:`);
    }
  });

  it("uses the Finder blue for folders in both blocks", () => {
    expect(darkBlock).toContain("--color-file-folder: #3e9bff;");
    expect(lightBlock).toContain("--color-file-folder: #0b6bcb;");
  });

  it("moves the media family off blue so it cannot collide with folders", () => {
    expect(darkBlock).toContain("--color-file-media: #818cf8;");
    expect(lightBlock).toContain("--color-file-media: #4f46e5;");

    const read = (block: string, token: string) =>
      new RegExp(`--color-file-${token}:\\s*(#[0-9a-fA-F]{3,8})`).exec(
        block,
      )?.[1];
    for (const block of [darkBlock, lightBlock]) {
      const folder = read(block, "folder");
      const media = read(block, "media");
      expect(folder).toBeTruthy();
      expect(media).toBeTruthy();
      expect(folder).not.toBe(media);
    }
  });

  it("never declares the file tokens inside a theme preset block", () => {
    const presetBlocks = source.slice(presetStart);
    for (const token of TOKENS) {
      expect(presetBlocks).not.toContain(`--color-file-${token}:`);
    }
  });
});
