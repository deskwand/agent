/**
 * @module renderer/utils/tts/selection-speech
 *
 * 划词朗读的会话：给一段文本就出声，随时能停。与 `useReadAloud` 刻意分开 ——
 * 那个 controller 的接口是 `start(messageId, root)`，状态与逐句高亮都按消息 DOM 走，
 * 而选区可能落在文件预览、灵感正文里，没有 messageId。这里只需要「出声 / 停 / 在不在播」。
 *
 * 状态进 store：三说话者互停是 store 订阅实现的（见 hooks/useFeedListen 的
 * useSpeakerInterrupts）。
 */
import { useAppStore } from "../../store";
import { createAudioQueue, type AudioQueue } from "./audio-queue";
import { speakStream, type SpeakStreamHandlers } from "./speak-stream";

export interface SelectionSpeechState {
  status: "idle" | "preparing" | "playing" | "error";
  error?: string;
}

/** 「正在出声」的唯一判据。`error` 不算 —— 把它算进去会让失败后只能先空停一次才能重试。 */
export function isSpeaking(status: SelectionSpeechState["status"]): boolean {
  return status === "preparing" || status === "playing";
}

export interface SelectionSpeechController {
  start(text: string): void;
  stop(): void;
  getState(): SelectionSpeechState;
}

export interface SelectionSpeechDeps {
  speak: (text: string, handlers: SpeakStreamHandlers) => () => void;
  /** 一场一个 context：Chromium 有并发上限，用过的要 close（与 useFeedListen 同法）。 */
  createContext: () => AudioContext;
  createQueue: (createContext: () => AudioContext) => AudioQueue;
  setState: (patch: Partial<SelectionSpeechState>) => void;
}

export function createSelectionSpeechController(
  deps: SelectionSpeechDeps,
): SelectionSpeechController {
  let state: SelectionSpeechState = { status: "idle" };
  let cancelStream: (() => void) | null = null;
  let queue: AudioQueue | null = null;
  let context: AudioContext | null = null;
  /**
   * 场次号。停止或重新起播后，上一场的块与回调（队列的 `onDrained` 是异步到的）
   * 一律按过期的丢弃 —— 否则迟到的那一下会把刚开始的新会话清成 idle。
   */
  let generation = 0;

  const set = (patch: Partial<SelectionSpeechState>) => {
    state = { ...state, ...patch };
    deps.setState(patch);
  };

  const releaseContext = () => {
    const live = context;
    context = null;
    if (live) void live.close();
  };

  const stop = () => {
    generation += 1;
    cancelStream?.();
    cancelStream = null;
    queue?.stop();
    queue = null;
    releaseContext();
    // 无条件写 idle：不能拿内部 state 做幂等判据 —— 那是第二份真相，
    // 它与 store 一旦分叉（比如别处直接写了切片），停止就会静默失效。
    set({ status: "idle", error: undefined });
  };

  const fail = (error: string) => {
    cancelStream = null;
    queue?.stop();
    queue = null;
    releaseContext();
    set({ status: "error", error });
  };

  const start = (text: string) => {
    const spoken = text.trim();
    if (!spoken) return;
    stop(); // 先收上一场：这一下也会把 generation 推进
    const gen = generation;
    try {
      context = deps.createContext();
    } catch (error) {
      // Chromium 在 AudioContext 数量达到上限时 `new AudioContext()` 会抛。
      fail(error instanceof Error ? error.message : String(error));
      return;
    }
    const captured = context;
    const next = deps.createQueue(() => captured);
    queue = next;
    set({ status: "preparing", error: undefined });
    next.onSentenceStart(() => {
      if (gen !== generation) return;
      set({ status: "playing" });
    });
    next.onDrained(() => {
      if (gen !== generation) return;
      queue = null;
      cancelStream = null;
      releaseContext();
      set({ status: "idle" });
    });
    /**
     * 先声明再赋值：`speak` 可能在**同步**回调里就报错（桥缺席那条路径），
     * 那时 handler 里的 `cancelStream = null` 会被这里的返回值覆盖成空函数。
     */
    let cancel: (() => void) | null = null;
    cancel = deps.speak(spoken, {
      onChunk: ({ samples, sampleRate }) => {
        if (gen !== generation) return;
        // 句子号恒为 0：划词朗读不做逐句进度，队列只用它触发一次「开始出声」。
        next.enqueue({ sentenceIndex: 0, samples, sampleRate });
      },
      onDone: () => {
        if (gen !== generation) return;
        next.markLast();
      },
      onError: (error) => {
        if (gen !== generation) return;
        fail(error);
      },
    });
    if (cancelStream !== null) return; // 同步报错已经收过尾了
    cancelStream = cancel;
  };

  return { start, stop, getState: () => state };
}

/** 全应用一个实例：两条划词朗读同时出声不是需求，两条音频队列却是真实的内存。 */
let singleton: SelectionSpeechController | null = null;

export function selectionSpeechController(): SelectionSpeechController {
  singleton ??= createSelectionSpeechController({
    speak: (text, handlers) => speakStream(text, undefined, handlers),
    createContext: () => new AudioContext(),
    createQueue: (createContext) => createAudioQueue({ createContext }),
    setState: (patch) => useAppStore.getState().setSelectionSpeech(patch),
  });
  return singleton;
}

/** 停掉正在播的划词朗读。三说话者互停、Esc、错误收尾都走它。 */
export function stopSelectionSpeech(): void {
  selectionSpeechController().stop();
}
