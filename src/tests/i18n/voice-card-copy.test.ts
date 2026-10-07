import { describe, expect, it } from "vitest";
import en from "../../renderer/i18n/locales/en.json";
import zh from "../../renderer/i18n/locales/zh.json";

/**
 * 「语音」卡的文案。
 *
 * 这一版改的是**概念**：档位那一行从「音色」改叫「音质」（它与下面的「音色」撞名了），
 * 卡片从「语音对话」扩成朗读与对话共用，最佳档的说明去掉同义反复、三个体积数字挪走
 * （安装按钮上已有体积）。
 *
 * 键集一致性由 `locale-parity.test.ts` 覆盖，这里只钉值。
 */
const zhCopy = zh.settings.capabilities.voiceMode;
const enCopy = en.settings.capabilities.voiceMode;

describe("语音卡文案", () => {
  it("档位行叫「音质」，子行才叫「音色」—— 两行不再撞名", () => {
    expect(zhCopy.tone).toBe("音质");
    expect(zhCopy.toneBestVoice).toBe("音色");
    expect(enCopy.tone).toBe("Quality");
    expect(enCopy.toneBestVoice).toBe("Voice");
  });

  it("卡片说明点明两处共用", () => {
    expect(zhCopy.title).toBe("语音");
    expect(zhCopy.desc).toBe("朗读与语音对话共用这里的音质与音色");
    expect(enCopy.title).toBe("Voice");
    expect(enCopy.desc).toBe("Shared by read-aloud and voice chat");
  });

  it("三档说明只讲差别，不带体积数字", () => {
    expect(zhCopy.toneDesc).toBe(
      "快速最省内存、首声最快；均衡音质更好、稍慢；最佳音质在本机跑大模型。",
    );
    expect(zhCopy.toneDescNoBest).toBe(
      "快速最省内存、首声最快；均衡音质更好、稍慢。",
    );
    expect(enCopy.toneDesc).toBe(
      "Fast needs the least memory and starts quickest; Balanced sounds better and is a little slower; Best runs a local model on this machine.",
    );
    expect(enCopy.toneDescNoBest).toBe(
      "Fast needs the least memory and starts quickest; Balanced sounds better and is a little slower.",
    );
  });

  it("最佳档说明去掉同义反复", () => {
    expect(zhCopy.toneBestNote).toBe(
      "装完离线可用；首声约 1–2 秒，说话时约 3GB 内存，空闲 10 分钟自动释放。",
    );
    expect(enCopy.toneBestNote).toBe(
      "Works offline once installed; first sound in about 1-2 seconds, about 3GB of memory while speaking, released after 10 idle minutes.",
    );
  });
});
