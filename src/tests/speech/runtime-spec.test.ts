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

  it("pins the best-quality engine coordinates", () => {
    // `ttsEngine` 是嵌套对象，与上面三个扁平字段形状不同，所以另读一次并给出结构。
    //
    // 为什么值得钉死：这三个数一旦与 CDN 上的字节不符，用户点「安装」拿到的就是
    // 404 或哈希不符；而这一档唯一的端到端覆盖是默认跳过的 1.5GB e2e。
    const { ttsEngine: engine } = JSON.parse(
      readFileSync(
        join(process.cwd(), "resources", "voice-runtime.json"),
        "utf8",
      ),
    ) as {
      ttsEngine: {
        version: string;
        talkerUrl: string;
        talkerSha256: string;
        talkerBytes: number;
        tokenizerUrl: string;
        tokenizerSha256: string;
        tokenizerBytes: number;
      };
    };

    expect(engine.talkerUrl).toBe(
      "https://file.deskwand.com/voice-engines/qwen-talker-1.7b-customvoice-Q4_K_M.gguf",
    );
    expect(engine.talkerSha256).toBe(
      "cc328834a631bc08bf9f43e62fa23f8a1383d9b429864ce6690cfb172077fc4a",
    );
    expect(engine.talkerBytes).toBe(1182631296);
    // 版本目录名 = 上游 commit，**不是**模型名：只有换引擎产物才改它（设计 §5）。
    expect(engine.version).toBe("6fae929");
    // tokenizer 两个 talker 共用，换模型时它不该动 —— 动了说明有人误改。
    expect(engine.tokenizerSha256).toBe(
      "1883beeed99348fc35e23dd225e9082f93f6f8c109330a33d935baa8acdbfd94",
    );
    expect(engine.tokenizerBytes).toBe(291150624);
  });
});
