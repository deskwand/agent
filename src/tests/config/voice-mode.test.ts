import { describe, it, expect } from "vitest";
import {
  normalizeVoiceModeConfig,
  DEFAULT_VOICE_MODE,
} from "../../shared/voice-mode";

describe("normalizeVoiceModeConfig", () => {
  it("falls back to defaults for junk", () => {
    expect(normalizeVoiceModeConfig(undefined)).toEqual(DEFAULT_VOICE_MODE);
    expect(normalizeVoiceModeConfig("nope")).toEqual(DEFAULT_VOICE_MODE);
    expect(normalizeVoiceModeConfig({})).toEqual(DEFAULT_VOICE_MODE);
  });

  it("clamps the silence window into a sane range", () => {
    expect(normalizeVoiceModeConfig({ silenceMs: 10 }).silenceMs).toBe(400);
    expect(normalizeVoiceModeConfig({ silenceMs: 99999 }).silenceMs).toBe(2000);
    expect(normalizeVoiceModeConfig({ silenceMs: 900 }).silenceMs).toBe(900);
  });
});
