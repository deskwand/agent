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

const TILE_MIN = 1.4;
const TILE_MAX = 22.6;

/**
 * 只处理本图标集用到的命令（M/L/H/V/A/Z 及其小写相对形式），
 * 返回路径经过的所有锚点。用于把「图形是否跑出色块」变成断言——
 * 否则把某个 path 改到 y=99，全套测试依然全绿。
 */
function pathPoints(d: string): [number, number][] {
  const tokens = d.match(/[MmLlHhVvAaZz]|-?\d*\.?\d+/g) ?? [];
  const points: [number, number][] = [];
  let x = 0;
  let y = 0;
  let i = 0;
  let cmd = "";
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[MmLlHhVvAaZz]/.test(tokens[i])) {
      cmd = tokens[i++];
      continue;
    }
    switch (cmd) {
      case "M":
      case "L":
        x = num();
        y = num();
        break;
      case "m":
      case "l":
        x += num();
        y += num();
        break;
      case "H":
        x = num();
        break;
      case "h":
        x += num();
        break;
      case "V":
        y = num();
        break;
      case "v":
        y += num();
        break;
      case "A":
      case "a": {
        const rx = num();
        const ry = num();
        const rot = num();
        const large = num();
        const sweep = num();
        const dx = num();
        const dy = num();
        (void rx, ry, rot, large, sweep);
        if (cmd === "A") {
          x = dx;
          y = dy;
        } else {
          x += dx;
          y += dy;
        }
        break;
      }
      default:
        i += 1;
        continue;
    }
    points.push([x, y]);
  }
  return points;
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

  it("keeps every glyph inside the tile", () => {
    for (const kind of ALL_KINDS) {
      for (const expanded of [false, true]) {
        const html = render(kind, { expanded });
        const paths = [...html.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
        expect(paths.length).toBeGreaterThan(0);
        for (const d of paths) {
          for (const [x, y] of pathPoints(d)) {
            expect(x, `${kind} expanded=${expanded} x`).toBeGreaterThanOrEqual(
              TILE_MIN,
            );
            expect(x, `${kind} expanded=${expanded} x`).toBeLessThanOrEqual(
              TILE_MAX,
            );
            expect(y, `${kind} expanded=${expanded} y`).toBeGreaterThanOrEqual(
              TILE_MIN,
            );
            expect(y, `${kind} expanded=${expanded} y`).toBeLessThanOrEqual(
              TILE_MAX,
            );
          }
        }
      }
    }
  });

  it("draws the folder as two panels with a lighter front panel", () => {
    const folder = render("folder");
    // 后板 + 前板：Finder 式文件夹靠这个前后层次才像文件夹，
    // 单板字形在 16px 下会退化成一块圆角矩形
    expect(folder.match(/<path/g)?.length).toBe(2);
    expect(folder).toContain("fill-opacity=");
    expect(render("folder", { expanded: true })).not.toBe(folder);
    expect(render("folder", { expanded: true }).match(/<path/g)?.length).toBe(
      2,
    );
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
