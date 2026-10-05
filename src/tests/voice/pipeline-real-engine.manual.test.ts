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

/** 短句夹具。生成：`say -v Tingting -o /tmp/voice-short.wav --data-format=LEI16@16000 "你好"` */
const SHORT_WAV = process.env.VOICE_E2E_SHORT_WAV ?? "/tmp/voice-short.wav";
/**
 * 短句那条**故意不复用 `ENABLED`**：那个常量要求长句夹具存在，而两者毫无关系。
 * 复用会让长句夹具一缺，这条回归就静默 skip —— 而 skip 看起来和通过一样。
 */
const SHORT_ENABLED =
  process.env.VOICE_E2E === "1" &&
  existsSync(SHORT_WAV) &&
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

/**
 * 短句回归。**这是那个本该早点存在的测试。**
 *
 * 2026-10-05 的真实故障：语音模式说「你好」一个字都不出。根因是
 * `finish()` 没补右上下文，而 0.5 秒的整句都落在右上下文里。
 * 之前所有夹具都是 3~10 秒的长句，所以这条路径从没被覆盖过 ——
 * 现有的长句那条在**有 bug 的代码上就是绿的**。
 *
 * 用假 addon 的单测只能证明「按要求补了静音」；只有真模型能证明「补完真的出字」。
 */
describe.skipIf(!SHORT_ENABLED)(
  "short utterance through the real engine",
  () => {
    it("0.5 秒的短语也要出字", async () => {
      const addon = loadSherpaAddon(join(ROOT, "voice"), "1.13.8");
      const engine = new LocalTranscriptionEngine({
        addon,
        modelDir: join(ROOT, "voice/models/x-asr-480ms-zh-en-punct-int8"),
      });

      let done: { text: string; discarded: boolean } | null = null;
      const session = new VoiceSession({
        engine,
        events: {
          onPartial: () => {},
          onDone: (payload) => {
            done = payload;
          },
          onError: (code, message) => {
            // 把引擎的原始消息带出来 —— 只报 code 会把诊断信息淹掉
            throw new Error(`session errored: ${code} — ${message}`);
          },
        },
      });

      const pcm = readPcm16(SHORT_WAV);
      const STEP = 1600; // 100ms @ 16k，与渲染层实际发送的粒度一致
      for (let i = 0; i < pcm.length; i += STEP) {
        session.push(pcm.subarray(i, i + STEP));
      }
      await session.stop();

      // 关键断言：**非空**。不补静音时这里拿到的是空串，这正是线上症状。
      // 2 个字是下限：出 1 个字说明还有截断（属于「补得不够」的另一类回归）。
      //
      // 不钉死具体内容：模型可能把 TTS 的「你好」转成「您好」或「你好啊」，
      // 那会让这条测试假红 —— 而它要守的只是「短句不再一个字都不出」。
      expect(done).not.toBeNull();
      expect(
        (done as unknown as { text: string }).text.length,
      ).toBeGreaterThanOrEqual(2);
    }, 60_000);
  },
);
