import { describe, expect, it } from "vitest";
import zh from "../../renderer/i18n/locales/zh.json";
import en from "../../renderer/i18n/locales/en.json";
import {
  CAPABILITIES,
  capabilitySizeTotalMb,
} from "../../renderer/capabilities/catalog";

const at = (dict: unknown, path: string): string => {
  const value = path
    .split(".")
    .reduce<unknown>(
      (acc, key) => (acc as Record<string, unknown>)?.[key],
      dict,
    );
  if (typeof value !== "string") throw new Error(`缺 key: ${path}`);
  return value;
};

describe("能力清单的文案", () => {
  it("两种语言的键都齐", () => {
    for (const spec of CAPABILITIES) {
      expect(at(zh, spec.titleKey).length).toBeGreaterThan(0);
      expect(at(en, spec.titleKey).length).toBeGreaterThan(0);
      expect(at(zh, spec.descKey).length).toBeGreaterThan(0);
      expect(at(en, spec.descKey).length).toBeGreaterThan(0);
    }
    for (const key of [
      "capabilityIntro.collapsedLead",
      "capabilityIntro.collapsedSizes",
      "capabilityIntro.expand",
      "capabilityIntro.dismiss",
      "capabilityIntro.dismissAll",
      "capabilityIntro.action.enable",
      "capabilityIntro.state.ready",
      "capabilityIntro.state.downloading",
      "capabilityIntro.state.queued",
      "capabilityIntro.state.retry",
      "capabilityIntro.confirm.voice",
      "voiceMode.ttsMissingHint",
      "voiceMode.ttsMissingAction",
      "voiceMode.asrReadyHint",
      "voiceMode.micBusy",
      "messageCard.readAloudReadyAgain",
    ]) {
      expect(at(zh, key).length).toBeGreaterThan(0);
      expect(at(en, key).length).toBeGreaterThan(0);
    }
  });

  it("每行 desc 里的体积数字与表里的 sizeMb 一致", () => {
    for (const spec of CAPABILITIES) {
      expect(at(zh, spec.descKey)).toContain(String(spec.sizeMb));
      expect(at(en, spec.descKey)).toContain(String(spec.sizeMb));
    }
  });

  it("折叠态的合计 = 三行之和", () => {
    const total = capabilitySizeTotalMb();
    expect(at(zh, "capabilityIntro.collapsedSizes")).toContain(String(total));
    expect(at(en, "capabilityIntro.collapsedSizes")).toContain(String(total));
  });

  it("与「设置 → 能力」那三条 desc 的数字一致（两处漂移守卫）", () => {
    const numbers = (value: string) => (value.match(/\d+/g) ?? []).join(",");
    expect(numbers(at(zh, "capabilityIntro.voiceInput.desc"))).toBe(
      numbers(at(zh, "settings.capabilities.voice.desc")),
    );
    expect(numbers(at(zh, "capabilityIntro.ocr.desc"))).toBe(
      numbers(at(zh, "settings.capabilities.ocr.desc")),
    );
    expect(numbers(at(en, "capabilityIntro.voiceInput.desc"))).toBe(
      numbers(at(en, "settings.capabilities.voice.desc")),
    );
    expect(numbers(at(en, "capabilityIntro.ocr.desc"))).toBe(
      numbers(at(en, "settings.capabilities.ocr.desc")),
    );
  });

  it("语音输入的确认弹窗复用现有文案，不另写一条", () => {
    expect(at(zh, "chat.voiceDownloadConfirm").length).toBeGreaterThan(0);
    expect(at(zh, "capabilityIntro.confirm.voice").length).toBeGreaterThan(0);
  });
});
