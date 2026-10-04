/**
 * @module tests/voice/partial-punctuation.manual
 *
 * Spike：流式 partial 里到底有没有标点？
 *
 * 结论决定轮次判定走哪条路：
 *   有 → 标点启发式（`renderer/utils/voice/turn-heuristic.ts`，已接入）
 *   无 → 该模块作废，改用语义轮次模型（Smart Turn v3 之类）
 *
 * 当前实现假定"有"。这个 manual test 就是验这个假定 —— 所以它不进 CI
 * （CI 没有麦克风录出来的音频），改动 `turn-heuristic` 的判据前先跑它。
 *
 * 手动跑：
 *   ffmpeg -i <录音> -ar 16000 -ac 1 -c:a pcm_s16le /tmp/turn-test.wav
 *   TURN_TEST_USERDATA="$HOME/Library/Application Support/DeskWand" \
 *     npx vitest run src/tests/voice/partial-punctuation.manual.test.ts
 *
 * 需要在「设置 → 能力 → 语音」里装好语音运行时。
 *
 * 两个条件都要满足才会跑（没有环境变量或没有 WAV 就跳过）—— 与
 * `pipeline-real-engine.manual.test.ts` 同一个约定：夹具是机器相关的，
 * 不该让别人的 CI 变红。
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "vitest";
import {
  LocalTranscriptionEngine,
  loadSherpaAddon,
} from "../../main/voice/local-engine";
import {
  MODEL_ID,
  RUNTIME_VERSION,
  voiceRoot,
} from "../../main/speech/installer";

const AUDIO = process.env.TURN_TEST_WAV ?? "/tmp/turn-test.wav";
const USER_DATA = process.env.TURN_TEST_USERDATA ?? "";

/** 只认 16kHz 单声道 PCM16 的 WAV。够这个 spike 用，不为它引依赖。 */
function readWav(file: string): Float32Array {
  const buf = readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error("not RIFF");
  const channels = buf.readUInt16LE(22);
  const rate = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  if (channels !== 1 || rate !== 16000 || bits !== 16)
    throw new Error(
      `need 16kHz mono pcm16, got ${rate}Hz ${channels}ch ${bits}bit`,
    );
  // data chunk 不一定在偏移 44：遍历 chunk 头找它，别硬编码。
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "data") {
      const n = Math.floor(size / 2);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i += 1)
        out[i] = buf.readInt16LE(offset + 8 + i * 2) / 0x8000;
      return out;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}

describe.skipIf(!USER_DATA || !existsSync(AUDIO))(
  "manual: partial 里有没有标点",
  () => {
    it("每 100ms 打印一次 partial", () => {
      const engine = new LocalTranscriptionEngine({
        addon: loadSherpaAddon(voiceRoot(USER_DATA), RUNTIME_VERSION),
        modelDir: `${voiceRoot(USER_DATA)}/models/${MODEL_ID}`,
      });
      const stream = engine.createStream();
      const pcm = readWav(AUDIO);
      const FRAME = 1600; // 100ms
      let last = "";
      let index = 0;
      for (let i = 0; i < pcm.length; i += FRAME) {
        const update = stream.push(pcm.subarray(i, i + FRAME));
        const text = update.segment ?? update.partial;
        const seconds = ((i + FRAME) / 16000).toFixed(1);
        if (text && text !== last) {
          last = text;
          index += 1;
          // eslint-disable-next-line no-console
          console.log(`[${index}] t=${seconds}s ${JSON.stringify(text)}`);
        }
        if (update.segment) last = "";
      }
      void stream.finish();
    });
  },
);
