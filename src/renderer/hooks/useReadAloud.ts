/**
 * @module renderer/hooks/useReadAloud
 *
 * 一次朗读的会话：抽文本 → 逐句要音频 → 排队播放 → 高亮当前句。
 *
 * 状态放在模块级的 controller 上，hook 只订阅：每条消息各持一个 AudioContext
 * 与一条队列是浪费，也会让「同时读两条」变成可能。
 *
 * 「合成下一句」在**当前句还在播**的时候就发起（流水线）。MeloTTS 的 RTF 是 0.71，
 * 慢机器上合成可能跟不上播放 —— 那时队列会短暂播空，恢复后接着播，不卡界面。
 */
import { useAppStore } from "../store";
import {
  extractSpeechSegments,
  joinSpeechTexts,
  spanSpeechTargets,
  type SpeechSegment,
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
  let segments: SpeechSegment[] = [];
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
    segments = [];
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
    queue.onSentenceStart((index) => {
      set({ currentIndex: index });
      highlight(segments[index]?.target ?? null);
    });
    queue.onDrained(() => reset());
    return queue;
  };

  const pump = (index: number, token: number): void => {
    const segment = segments[index];
    if (!segment) return;
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

    const endSegment = () => {
      // 分组后每块都是「最后一块」：流水线分支已不存在（合并的代价就是不抢跑下一块）
      ensureQueue().markLast();
    };

    cancel = deps.speak(segment.text, {
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
        endSegment();
      },
      onError: (error) => {
        forget();
        if (token !== generation) return;
        // 已经出过声的段：保留已播部分，当这一段结束（不弹错误 —— 用户已经听到了）。
        if (sawChunk) {
          endSegment();
          return;
        }
        queue?.stop();
        highlight(null); // 别把上一次的高亮留在屏幕上
        set({ status: "error", error });
      },
    });
    cancels.add(cancel);
  };

  /**
   * 把整条消息编成**少数几次请求**。
   *
   * 为什么要合并：最佳档每次请求都重新采样，切得越碎、句子之间越容易换音色
   * （实测每句一次请求时约 14% 的边界会跳音区）。首声只多 ~30ms（174 → 181ms 实测）。
   *
   * 为什么还要有上限：引擎 `max_new_tokens` 默认 2048，那是**声学帧数**
   * （`pipeline-tts.cpp`：`step >= max_new_tokens` 就停），codec 是 12Hz
   * → 约 170 秒音频 ≈ 760 个汉字。整条不切会让超长回复被**静默截断**。
   */
  const MAX_CHARS_PER_REQUEST = 600;

  const groupSegments = (raw: SpeechSegment[]): SpeechSegment[] => {
    const groups: SpeechSegment[][] = [];
    let current: SpeechSegment[] = [];
    let length = 0;
    for (const segment of raw) {
      if (
        current.length > 0 &&
        length + segment.text.length > MAX_CHARS_PER_REQUEST
      ) {
        groups.push(current);
        current = [];
        length = 0;
      }
      current.push(segment);
      length += segment.text.length;
    }
    if (current.length > 0) groups.push(current);
    return groups.map((group) => ({
      text: joinSpeechTexts(group.map((segment) => segment.text)),
      target:
        spanSpeechTargets(group.map((segment) => segment.target)) ??
        group[0]!.target,
    }));
  };

  return {
    getState: () => state,
    start(messageId, root) {
      reset();
      const token = generation;
      const raw = extractSpeechSegments(root).filter(
        (segment) => segment.text.trim().length > 0,
      );
      if (raw.length === 0) return; // 没有可读的文字：不开播，按钮那边已置灰
      /**
       * **整条消息一次请求**：最佳档每次请求都重新采样，切得越碎、句子之间越容易
       * 换音色（实测每句一次请求时约 14% 的边界会跳音区）。首声只多 ~30ms
       * （实测 174 → 181ms，引擎本来就是流式的）。
       *
       * 代价：逐句高亮退化为**整段高亮** —— 目标由首尾两段拼出来（见
       * `spanSpeechTargets`），播放中不再逐句推进。
       */
      segments = groupSegments(raw);
      set({
        messageId,
        status: "preparing",
        currentIndex: 0,
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
