import { describe, expect, it, vi } from "vitest";
import {
  appendSpeakerTone,
  buildSpeakerToneText,
} from "../../main/agent/speaker-tone-message";

describe("speaker tone 文本", () => {
  it("低于门槛不产出", () => {
    expect(buildSpeakerToneText({ label: "sad", confidence: 0.59 })).toBe("");
  });

  it("中性、其他、未知不产出", () => {
    for (const label of ["neutral", "other", "unknown"] as const) {
      expect(buildSpeakerToneText({ label, confidence: 0.99 })).toBe("");
    }
  });

  it("难过产出对应策略，且带类别与置信度", () => {
    const text = buildSpeakerToneText({ label: "sad", confidence: 0.98 });
    expect(text).toContain('<speaker_tone label="sad" confidence="0.98">');
    expect(text).toContain("Do not say you noticed their tone.");
    expect(text.trimEnd().endsWith("</speaker_tone>")).toBe(true);
  });

  it("生气与厌恶共用一个策略组", () => {
    const angry = buildSpeakerToneText({ label: "angry", confidence: 0.9 });
    const disgusted = buildSpeakerToneText({
      label: "disgusted",
      confidence: 0.9,
    });
    // label 在段里出现两次（属性 + 句子），所以必须 replaceAll。
    expect(angry.replaceAll("angry", "disgusted")).toBe(disgusted);
  });
});

describe("appendSpeakerTone", () => {
  it("流式输出中跳过，不抛错", async () => {
    const sendCustomMessage = vi.fn();
    await appendSpeakerTone(
      { sendCustomMessage, isStreaming: true },
      { label: "sad", confidence: 0.9 },
    );
    expect(sendCustomMessage).not.toHaveBeenCalled();
  });

  it("空闲时写一条 display:false 的 custom 消息", async () => {
    const sendCustomMessage = vi.fn(async () => {});
    await appendSpeakerTone(
      { sendCustomMessage, isStreaming: false },
      { label: "sad", confidence: 0.9 },
    );
    expect(sendCustomMessage).toHaveBeenCalledWith(
      {
        customType: "speaker_tone",
        content: expect.stringContaining("<speaker_tone"),
        display: false,
      },
      { triggerTurn: false },
    );
  });

  it("没有情感时不写", async () => {
    const sendCustomMessage = vi.fn(async () => {});
    await appendSpeakerTone(
      { sendCustomMessage, isStreaming: false },
      undefined,
    );
    expect(sendCustomMessage).not.toHaveBeenCalled();
  });
});
