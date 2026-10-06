/**
 * 渲染层 CSP 的 frame-src 不变量。
 *
 * 产物 iframe 用的是自定义 scheme。渲染层自己的 CSP 里 `default-src 'self'`，
 * 没有 frame-src 就回落成 `'self'`，自定义 scheme 的 iframe 会被**静默拦掉**——
 * 页面里什么都不显示，也不报错到我们能看见的地方。视频那轮踩过同一个坑，
 * 所以 `media-src` 里明确写着 `deskwand-media:`。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function rendererCsp(): string {
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const match = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(
    html,
  );
  if (!match) throw new Error("index.html 里没有 CSP meta");
  return match[1];
}

function directive(csp: string, name: string): string | null {
  const found = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  return found ?? null;
}

describe("renderer CSP frames", () => {
  it("allows the artifact scheme in frame-src", () => {
    const csp = rendererCsp();
    const frameSrc = directive(csp, "frame-src");
    expect(frameSrc).not.toBeNull();
    expect(frameSrc).toContain("deskwand-artifact:");
  });

  it("keeps the video scheme allowed for media", () => {
    expect(directive(rendererCsp(), "media-src")).toContain("deskwand-media:");
  });
});
