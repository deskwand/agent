/**
 * 手动 / 集成检查：把真音频喂进**真引擎 + 真会话**这条完整链路。
 *
 * 默认跳过（需要本地先装好运行时与模型），显式开启：
 *
 *   VOICE_E2E=1 npx vitest run src/tests/voice/pipeline-real-engine.manual.test.ts
 *
 * 为什么需要它：`session.test.ts` 用的是**假引擎**，它不经过 Int16→Float32 转换、
 * 不碰 sherpa 的 push/finish 路径。“会话层 + 真引擎”这个接缝因此从没被跑过 ——
 * 而接缝正是最容易出错的地方。
 *
 * 音频夹具：优先用 `VOICE_E2E_WAV` 指定的 WAV，否则找 `/tmp/voice-long.wav`。
 * 两者都没有就跳过 —— 夹具是机器相关的，不该让别人的 CI 变红。
 *
 * ⚠️ **不要与 `installer-real-artifacts.manual.test.ts` 并行跑**：两者共用
 * `/tmp/voice-install-check`，而安装器那条开头会 `rmSync` 整个目录，并行就是竞争。
 * 单独跑：
 *
 *   VOICE_E2E=1 npx vitest run src/tests/voice/pipeline-real-engine.manual.test.ts
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LocalTranscriptionEngine,
  loadSherpaAddon,
} from "../../main/voice/local-engine";
import { VoiceSession } from "../../main/voice/session";

const ROOT = "/tmp/voice-install-check";
const WAV = process.env.VOICE_E2E_WAV ?? "/tmp/voice-long.wav";
const ENABLED =
  process.env.VOICE_E2E === "1" &&
  existsSync(WAV) &&
  existsSync(
    join(ROOT, "voice/runtime/1.13.8/sherpa-onnx-node/sherpa-onnx.js"),
  );

/** 扫 chunk 读 WAV，返回 16k 单声道 PCM16。 */
function readPcm16(path: string): Int16Array {
  const buf = readFileSync(path);
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "data") {
      const pcm = buf.subarray(off + 8, off + 8 + size);
      return new Int16Array(
        pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + (pcm.length & ~1)),
      );
    }
    off += 8 + size + (size % 2);
  }
  throw new Error("WAV 里没有 data chunk");
}

describe.skipIf(!ENABLED)("session driving the real local engine", () => {
  it("turns 100ms PCM16 frames into accumulated text", async () => {
    // 走生产代码的加载器（而不是测试里自己 require）—— 这里恰好是曾经错的地方：
    // 它在 `sherpa-onnx.js`（高层包装）与 `addon.js`（原生 addon）之间拿错了文件，
    // 而单测用假 addon 注入，永远碰不到这一行。
    const addon = loadSherpaAddon(join(ROOT, "voice"), "1.13.8");
    const engine = new LocalTranscriptionEngine({
      addon,
      modelDir: join(ROOT, "voice/models/x-asr-480ms-zh-en-punct-int8"),
    });

    const partials: string[] = [];
    let done: { text: string; discarded: boolean } | null = null;
    const session = new VoiceSession({
      engine,
      events: {
        onPartial: (text) => partials.push(text),
        onDone: (payload) => {
          done = payload;
        },
        onError: (code, message) => {
          // 把引擎的原始消息带出来 —— 只报 code 会把诊断信息淹掉
          throw new Error(`session errored: ${code} — ${message}`);
        },
      },
    });

    const pcm = readPcm16(WAV);
    const STEP = 1600; // 100ms @ 16k —— 与渲染层实际发送的粒度一致
    for (let i = 0; i < pcm.length; i += STEP) {
      session.push(pcm.subarray(i, i + STEP));
    }
    await session.stop();

    // 段落会累积、partial 会变化，所以中途至少推过几次
    expect(partials.length).toBeGreaterThan(0);
    expect(done).not.toBeNull();
    const { text, discarded } = done as unknown as {
      text: string;
      discarded: boolean;
    };
    expect(discarded).toBe(false);
    // 真语音应当出字，而且应当**是那段话**（断言稳定子串，不写全文 ——
    // 全文会随模型版本变，那会让这个测试变成假红）。
    expect(text).toContain("语音输入");
    expect(text).toContain("标点");
    // 累积文本是单调变长的
    expect(text.length).toBeGreaterThanOrEqual(
      partials[partials.length - 1].length,
    );
  }, 120_000);
});
