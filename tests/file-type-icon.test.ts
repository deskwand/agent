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

/** kind → 期望的颜色 class。文件夹走主题文字 token，不再独占文件语义色。 */
const KIND_CLASS: Record<FileKind, string> = {
  folder: "text-text-secondary",
  image: "text-file-media",
  video: "text-file-media",
  doc: "text-file-doc",
  sheet: "text-file-doc",
  code: "text-file-code",
  audio: "text-file-audio",
  archive: "text-file-neutral",
  file: "text-file-neutral",
};

describe("FileTypeIcon", () => {
  it("draws a glyph for every kind without a colour tile", () => {
    for (const kind of ALL_KINDS) {
      const html = render(kind);
      // 有字形即可：lucide 的 Image / Table 自带 <rect> 画外框，
      // 所以守卫的是「画了东西」，不是「没有 rect」。
      expect(html, kind).toMatch(/<(path|rect|circle|line|polyline)/);
      // 色块时代给底板用的 fill-file-* class 不得再出现——这是「没有底板」的守卫
      expect(html, kind).not.toContain("fill-file-");
      expect(html, kind).toContain('aria-hidden="true"');
      expect(html, kind).toContain('role="presentation"');
    }
  });

  it("colours every kind through a semantic token class", () => {
    for (const kind of ALL_KINDS) {
      expect(render(kind), kind).toContain(KIND_CLASS[kind]);
    }
  });

  it("keeps folders on a theme text token instead of a file colour", () => {
    const html = render("folder");
    expect(html).toContain("text-text-secondary");
    expect(html).not.toContain("text-file-");
  });

  it("switches to the open-folder glyph only for folder", () => {
    expect(render("folder", { expanded: true })).not.toBe(render("folder"));
    // 钉住「展开态用的就是 lucide 的 FolderOpen」，而不只是「变了」
    expect(render("folder", { expanded: true })).toContain(
      "lucide-folder-open",
    );
    expect(render("folder")).toContain("lucide-folder");
    expect(render("image", { expanded: true })).toBe(render("image"));
    expect(render("code", { expanded: true })).toBe(render("code"));
  });

  it("honours the size prop", () => {
    expect(render("code", { size: 16 })).toContain('width="16"');
    expect(render("code", { size: 16 })).toContain('height="16"');
    expect(render("code", { size: 24 })).toContain('width="24"');
    expect(render("code", { size: 24 })).toContain('height="24"');
  });

  it("leaves the stroke geometry to lucide defaults", () => {
    // 设计决策：不覆盖 lucide 的默认属性，这样文件图标与 chevron、
    // 以及 app 里其余图标是同一个实现，而不是「数值恰好一致」。
    const html = render("code");
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('stroke-width="2"');
    expect(html).toContain('stroke-linecap="round"');
    expect(html).toContain('stroke-linejoin="round"');
    expect(html).toContain("lucide-code");
  });
});
