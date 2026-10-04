import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  LocalTranscriptionEngine,
  loadSherpaAddon,
} from "../../main/voice/local-engine";

const ROOT = "/tmp/voice-install-check";
const RUNTIME_VERSION = "1.13.8";
const MODEL_ID = "x-asr-480ms-zh-en-punct-int8";
const ENABLED =
  process.env.VOICE_E2E === "1" &&
  existsSync(
    join(ROOT, "voice/runtime", RUNTIME_VERSION, "sherpa-onnx-node/addon.js"),
  ) &&
  existsSync(join(ROOT, "voice/models", MODEL_ID));

describe.skipIf(!ENABLED)("createStream hot path", () => {
  it("measures the second createStream call", () => {
    const engine = new LocalTranscriptionEngine({
      addon: loadSherpaAddon(join(ROOT, "voice"), RUNTIME_VERSION),
      modelDir: join(ROOT, "voice/models", MODEL_ID),
    });

    const cold = performance.now();
    const first = engine.createStream();
    const coldMs = performance.now() - cold;

    const warm = performance.now();
    const second = engine.createStream();
    const warmMs = performance.now() - warm;

    // eslint-disable-next-line no-console -- 这个手动测试的存在意义就是把数字打给人看
    console.log(`cold=${coldMs.toFixed(0)}ms warm=${warmMs.toFixed(0)}ms`);
    first.abort();
    second.abort();
    expect(warmMs).toBeGreaterThanOrEqual(0);
  }, 120_000);
});
