/**
 * @module renderer/hooks/useReadAloud
 *
 * 一次朗读的会话：抽文本 → 分块（每 4 句一块，≤600 字）要音频 → 排队播放 → 高亮当前块。
 *
 * 状态放在模块级的 controller 上，hook 只订阅：每条消息各持一个 AudioContext
 * 与一条队列是浪费，也会让「同时读两条」变成可能。
 *
 * **抢跑**：当前块**合成结束**就发下一块（不等它播完），一次只有一个请求在飞。
 * 串行是有意的：并发在飞会让后块的音频先到，那就得给每块加缓冲、按序发布。而串行
 * 本身就无缝：只要合成比实时快（RTF < 1），下一块的首块音频总在上一块播完前到达 ——
 * 形式化一点是 ρ·a ≤ (1-ρ)·ΣA + ρ·a₀（ρ = 合成/音频耗时比 0.67、a = 首块音频 2.8s、
 * A = 每块音频，本机实测代入得 1.88 ≤ 6.93 + 1.88）。
 */
import { useAppStore } from "../store";
import {
  extractSpeechSegments,
  groupSpeechSegments,
  type SpeechBlock,
  type SpeechTarget,
} from "../utils/tts/speech-text";
import { createAudioQueue, type AudioQueue } from "../utils/tts/audio-queue";
import {
  speakStream,
  type SpeakStreamHandlers,
} from "../utils/tts/speak-stream";

export interface ReadAloudState {
  messageId: string | null;
  status: "idle" | "preparing" | "playing" | "paused" | "error";
  currentIndex: number;
  total: number;
  error?: string;
}

export interface ReadAloudDeps {
  /** 发一次流式合成，返回取消函数。块按引擎的标点分段到达。 */
  speak: (text: string, handlers: SpeakStreamHandlers) => () => void;
  createQueue: () => AudioQueue;
  /** 注入以便测试。默认写进 `useAppStore`（仓库约定：跨组件状态用 zustand）。 */
  setState?: (patch: Partial<ReadAloudState>) => void;
  /** 注入以便测试；默认真的改 CSS.highlights。 */
  applyHighlight?: (target: SpeechTarget | null) => void;
}

export interface ReadAloudController {
  getState(): ReadAloudState;
  start(messageId: string, root: HTMLElement): void;
  toggle(): void;
  stop(): void;
}

/**
 * 给当前句上底色。CSS Custom Highlight API 不动 DOM，所以不会打乱 React。
 * jsdom 里没有这套 API —— 直接跳过，不算失败。
 */
export function applyHighlight(target: SpeechTarget | null): void {
  if (typeof CSS === "undefined" || !CSS.highlights) return;
  CSS.highlights.delete("tts");
  if (!target) return;
  const range = document.createRange();
  if (target.kind === "range") {
    range.setStart(target.startNode, target.startOffset);
    range.setEnd(target.endNode, target.endOffset);
  } else {
    range.selectNodeContents(target.element);
  }
  CSS.highlights.set("tts", new Highlight(range));
}

export function createReadAloudController(
  deps: ReadAloudDeps,
): ReadAloudController {
  let state: ReadAloudState = {
    messageId: null,
    status: "idle",
    currentIndex: 0,
    total: 0,
  };
  /** 分块。一块 = 一次合成请求 = 队列里的"一句"（高亮与进度的粒度）。 */
  let blocks: SpeechBlock[] = [];
  let queue: AudioQueue | null = null;
  /**
   * 场次号。start / stop / 播完都 +1；每个异步回调回来先比对它。
   * 没有它，「读 A 时点 B」会让 A 的旧结果把 B 的队列弄乱。
   */
  let generation = 0;
  /** 在飞的取消函数。reset 时逐个调 —— 否则打断后那段会在主进程里白合成完。 */
  const cancels = new Set<() => void>();

  const set = (patch: Partial<ReadAloudState>) => {
    state = { ...state, ...patch };
    (deps.setState ?? pushToStore)(patch);
  };

  const highlight = (target: SpeechTarget | null) => {
    (deps.applyHighlight ?? applyHighlight)(target);
  };

  const reset = () => {
    generation++;
    for (const cancel of cancels) cancel();
    cancels.clear();
    queue?.stop();
    queue = null;
    blocks = [];
    highlight(null);
    set({
      messageId: null,
      status: "idle",
      currentIndex: 0,
      total: 0,
      error: undefined,
    });
  };

  const ensureQueue = (): AudioQueue => {
    if (queue) return queue;
    queue = deps.createQueue();
    queue.onSentenceStart((blockIndex) => {
      const block = blocks[blockIndex];
      // currentIndex 是**句号**：UI 文案是「第 X / Y 句」，报块号会读成「第 2/5 句」
      set({ currentIndex: block?.sentenceStart ?? 0 });
      highlight(block?.target ?? null);
    });
    queue.onDrained(() => reset());
    return queue;
  };

  const pump = (index: number, token: number): void => {
    const block = blocks[index];
    if (!block) return;
    const isLastBlock = index + 1 >= blocks.length;
    let sawChunk = false;
    /**
     * 先声明再赋值：桥缺失时 `speak` 会**同步**回调 `onError`，那时 `cancel`
     * 还在 TDZ 里，`cancels.delete(cancel)` 会抛 ReferenceError，把一次优雅降级
     * 变成崩溃。
     */
    let cancel: (() => void) | null = null;
    const forget = () => {
      if (cancel) cancels.delete(cancel);
    };

    const endBlock = () => {
      if (isLastBlock) ensureQueue().markLast();
      // 抢跑：不等这一块播完就发下一块（串行 —— 下一块要等这一块合成结束）
      else pump(index + 1, token);
    };

    cancel = deps.speak(block.text, {
      onChunk: (chunk) => {
        // 回来时可能已经被 start / stop 作废 —— 旧块直接丢
        if (token !== generation) return;
        sawChunk = true;
        ensureQueue().enqueue({
          sentenceIndex: index,
          samples: chunk.samples,
          sampleRate: chunk.sampleRate,
        });
        if (state.status === "preparing") set({ status: "playing" });
      },
      onDone: () => {
        forget();
        if (token !== generation) return;
        endBlock();
      },
      onError: (error) => {
        forget();
        if (token !== generation) return;
        // 已经出过声的块：保留已播部分，当这一块结束（不弹错误 —— 用户已经听到了）。
        if (sawChunk) {
          endBlock();
          return;
        }
        queue?.stop();
        highlight(null); // 别把上一次的高亮留在屏幕上
        set({ status: "error", error });
      },
    });
    cancels.add(cancel);
  };

  return {
    getState: () => state,
    start(messageId, root) {
      reset();
      const token = generation;
      const segments = extractSpeechSegments(root).filter(
        (segment) => segment.text.trim().length > 0,
      );
      if (segments.length === 0) return; // 没有可读的文字：不开播，按钮那边已置灰
      blocks = groupSpeechSegments(segments);
      set({
        messageId,
        status: "preparing",
        currentIndex: 0,
        // 按**句**上报，不是块数：UI 文案是「第 X / Y 句」
        total: segments.length,
      });
      pump(0, token);
    },
    toggle() {
      if (state.status === "playing") {
        queue?.pause();
        set({ status: "paused" });
        return;
      }
      if (state.status === "paused") {
        queue?.resume();
        set({ status: "playing" });
      }
    },
    stop() {
      reset();
    },
  };
}

/** 默认的写回：zustand store。 */
function pushToStore(patch: Partial<ReadAloudState>): void {
  useAppStore.getState().setReadAloud(patch);
}

function defaultDeps(): ReadAloudDeps {
  return {
    speak: (text, handlers) => speakStream(text, undefined, handlers),
    createQueue: () =>
      createAudioQueue({ createContext: () => new AudioContext() }),
  };
}

/** 全应用一个实例 —— 两条消息同时朗读不是需求，两条队列却是真实的内存。 */
let singleton: ReadAloudController | null = null;

function controller(): ReadAloudController {
  singleton ??= createReadAloudController(defaultDeps());
  return singleton;
}

export function useReadAloud(): ReadAloudState & {
  start: (messageId: string, root: HTMLElement) => void;
  toggle: () => void;
  stop: () => void;
} {
  const state = useAppStore((s) => s.readAloud);
  return {
    ...state,
    start: controller().start,
    toggle: controller().toggle,
    stop: controller().stop,
  };
}

/** 停掉正在播的整段朗读。浮层打开前调用，避免两路音频同时出声。 */
export function stopReadAloud(): void {
  controller().stop();
}
