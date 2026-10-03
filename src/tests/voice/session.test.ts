import { describe, expect, it, vi } from "vitest";
import { WRONG_TOUCH_MS, VoiceSession } from "../../main/voice/session";
import type {
  TranscribeUpdate,
  TranscriptionEngine,
  TranscriptionStream,
} from "../../main/voice/transcription-engine";

/** 按脚本吐结果的假引擎：第 n 次 push 返回脚本里第 n 项。 */
// 假的 TranscriptionEngine：按脚本吐结果，第 n 次 push 返回脚本里第 n 项。
//
// `finishText` 模拟**这一段的最终完整文本**（真实引擎与 TranscriptionResult 的约定），
// 所以它通常是「已推过的 partial + 尾巴」，**不是只含尾巴**。早先的版本把它当增量，
// 于是模拟出了一种真实引擎不会有的行为。
function engineFrom(script: TranscribeUpdate[], finishText = "") {
  const state = { pushed: 0 };
  const engine: TranscriptionEngine = {
    createStream(): TranscriptionStream {
      return {
        push() {
          const update = script[state.pushed] ?? { partial: "" };
          state.pushed += 1;
          return update;
        },
        async finish() {
          return { text: finishText };
        },
        abort() {},
      };
    },
  };
  return { engine, state };
}

function events() {
  return { onPartial: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
}

const samplesFor = (ms: number) => new Int16Array((16000 * ms) / 1000);

describe("VoiceSession", () => {
  it("只在本段文本真的变了时才推 partial", async () => {
    // 拾音帧率是 10Hz，而文字可能几秒不动。不判的话 30 秒听写会推约 300 次，
    // 每次都让输入框 re-render 一次。
    const { engine } = engineFrom([
      { partial: "你好" },
      { partial: "你好" },
      { partial: "你好" },
    ]);
    const sink = events();
    const session = new VoiceSession({ engine, events: sink });

    session.push(samplesFor(100));
    session.push(samplesFor(100));
    session.push(samplesFor(100));

    expect(sink.onPartial).toHaveBeenCalledTimes(1);
    expect(sink.onPartial).toHaveBeenCalledWith("你好");
  });

  it("accumulates finalized segments plus the live partial", () => {
    const { engine } = engineFrom([
      { partial: "你好" },
      { partial: "", segment: "你好世界" },
      { partial: "再见" },
    ]);
    const sink = events();
    const session = new VoiceSession({ engine, events: sink });

    session.push(samplesFor(100));
    session.push(samplesFor(100));
    session.push(samplesFor(100));

    expect(sink.onPartial).toHaveBeenLastCalledWith("你好世界再见");
  });

  it("discards a press shorter than the wrong-touch threshold that produced no text", async () => {
    const { engine } = engineFrom([{ partial: "" }]);
    const sink = events();
    const session = new VoiceSession({ engine, events: sink });

    session.push(samplesFor(WRONG_TOUCH_MS - 100));
    await session.stop();

    expect(sink.onDone).toHaveBeenCalledWith({ text: "", discarded: true });
  });

  it("keeps a short press that did produce text", async () => {
    const { engine } = engineFrom([{ partial: "嗯" }]);
    const sink = events();
    const session = new VoiceSession({ engine, events: sink });

    session.push(samplesFor(WRONG_TOUCH_MS - 100));
    await session.stop();

    expect(sink.onDone).toHaveBeenCalledWith({ text: "嗯", discarded: false });
  });

  it("replaces the pending partial with the finished segment on stop", async () => {
    // 真实引擎的 finish() 返回整段最终文本（“前半”是已经推过的 partial）——
    // 所以它应当**取代** partial，而不是接在它后面。
    const { engine } = engineFrom([{ partial: "前半" }], "前半尾句");
    const sink = events();
    const session = new VoiceSession({ engine, events: sink });

    session.push(samplesFor(1000));
    await session.stop();

    expect(sink.onDone).toHaveBeenCalledWith({
      text: "前半尾句",
      discarded: false,
    });
  });

  it("ignores audio after stop", async () => {
    const { engine, state } = engineFrom([{ partial: "a" }, { partial: "b" }]);
    const sink = events();
    const session = new VoiceSession({ engine, events: sink });

    session.push(samplesFor(1000));
    await session.stop();
    const before = state.pushed;
    session.push(samplesFor(1000));

    expect(state.pushed).toBe(before);
  });

  it("emits nothing after abort", async () => {
    const { engine } = engineFrom([{ partial: "a" }]);
    const sink = events();
    const session = new VoiceSession({ engine, events: sink });

    session.push(samplesFor(1000));
    session.abort();
    await session.stop();

    expect(sink.onDone).not.toHaveBeenCalled();
    expect(sink.onError).not.toHaveBeenCalled();
  });
});
