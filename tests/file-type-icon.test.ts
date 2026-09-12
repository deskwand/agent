import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FileTypeIcon } from "../src/renderer/components/file-type-icon";
import type { FileKind } from "../src/renderer/utils/file-types";

const ALL_KINDS: FileKind[] = [
  "folder",
  "image",
  "video",
  "audio",
  "doc",
  "sheet",
  "code",
  "archive",
  "file",
];

function render(
  kind: FileKind,
  props: { expanded?: boolean; size?: number } = {},
) {
  return renderToStaticMarkup(
    React.createElement(FileTypeIcon, { kind, ...props }),
  );
}

describe("FileTypeIcon", () => {
  it("renders a tile plus at least one glyph for every kind", () => {
    for (const kind of ALL_KINDS) {
      const html = render(kind);
      expect(html).toContain("<rect");
      expect(html).toContain("<path");
      expect(html).toContain('aria-hidden="true"');
    }
  });

  it("groups the nine kinds into the six fixed colour tokens", () => {
    expect(render("folder")).toContain("fill-file-folder");
    expect(render("image")).toContain("fill-file-media");
    expect(render("video")).toContain("fill-file-media");
    expect(render("doc")).toContain("fill-file-doc");
    expect(render("sheet")).toContain("fill-file-doc");
    expect(render("code")).toContain("fill-file-code");
    expect(render("audio")).toContain("fill-file-audio");
    expect(render("archive")).toContain("fill-file-neutral");
    expect(render("file")).toContain("fill-file-neutral");
  });

  it("switches to the open-folder glyph only for folder", () => {
    expect(render("folder", { expanded: true })).not.toBe(render("folder"));
    expect(render("image", { expanded: true })).toBe(render("image"));
    expect(render("code", { expanded: true })).toBe(render("code"));
  });

  it("honours the size prop and scales the tile radius", () => {
    expect(render("code", { size: 16 })).toContain('width="16"');
    expect(render("code", { size: 16 })).toContain('rx="4.6"');
    expect(render("code", { size: 24 })).toContain('width="24"');
    expect(render("code", { size: 24 })).toContain('rx="6"');
  });

  it("keeps the white glyph contract for filled and outline shapes", () => {
    // 实心字形（文件夹、图片、视频、音频的音符头）用 fill-white
    expect(render("folder")).toContain("fill-white");
    expect(render("video")).toContain("fill-white");
    // 描边字形（代码、文档、表格、压缩包、通用文件）必须显式清掉 fill，
    // 否则会回退到 SVG 默认的黑色填充
    expect(render("code")).toContain("fill-none");
    expect(render("code")).toContain("stroke-white");
    expect(render("doc")).toContain("fill-none");
    expect(render("doc")).toContain("stroke-white");
  });
});
