import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 随包清单的坐标是**发布物契约**：写错一个字符，用户点下载就是 404 或哈希不符。
 * 直接读 JSON（不经 `readRuntimeSpec()`，那个要走 Electron 的 `app`），
 * 与 `installer-real-artifacts.manual.test.ts` 同一套做法。
 */
describe("voice runtime spec", () => {
  const spec = JSON.parse(
    readFileSync(
      join(process.cwd(), "resources", "voice-runtime.json"),
      "utf8",
    ),
  ) as Record<string, string>;

  it("exposes the English model coordinates", () => {
    expect(spec.ttsEnglishModelUrl).toMatch(
      /^https:\/\/file\.deskwand\.com\/voice-models\/vits-melo-tts-en-[0-9a-f]{8}\.tar\.gz$/,
    );
    expect(spec.ttsEnglishModelSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the Chinese model coordinates untouched", () => {
    expect(spec.ttsModelUrl).toMatch(
      /^https:\/\/file\.deskwand\.com\/voice-models\/vits-melo-tts-zh_en-[0-9a-f]{8}\.tar\.gz$/,
    );
    expect(spec.ttsModelSha256).toBe(
      "7bab269000d966e73c33e78409254ffb3394cf557c7fde004ff5c256c4d3f45f",
    );
  });

  it("exposes the fast voice coordinates", () => {
    expect(spec.ttsFastModelUrl).toMatch(
      /^https:\/\/file\.deskwand\.com\/voice-models\/matcha-icefall-zh-en-[0-9a-f]{8}\.tar\.gz$/,
    );
    // 钉字面量：键名是内容寻址的，所以改这里必须先重新打包并重新上传，
    // 否则公网上的旧字节会被 CDN 钉住（上传脚本的注释里有实测记录）。
    expect(spec.ttsFastModelSha256).toBe(
      "d08c42e0af7c546784a6689e905846a3bec36ecdd48623a0ae4624ddaf3c96c2",
    );
  });
});
