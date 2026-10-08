/**
 * @module renderer/hooks/useFeedListen
 *
 * 收听会话：把一串条目（每条一段口播稿）串成一期，一条接一条播下去。
 *
 * 复用消息朗读的音频链路（`speakStream` + `createAudioQueue`）与它的**抢跑**
 * 策略：当前块**合成结束**就发下一块，一次只有一个请求在飞。整场是一条线性的
 * 块列表，条目边界只是列表上的标记，所以「合成比播放快」的结论直接跨条目成立。
 *
 * 与消息朗读的三点不同：
 *  1. 文本源是库里的稿子，不是 DOM —— 没有高亮；
 *  2. 会话自己持有 AudioContext 并在结束时 close（仓库约定：谁建谁释放）；
 *  3. 条目级回调（跟随 / 已读）由宿主注入，控制器不认识 store。
 */
import { useEffect } from "react";
import { useAppStore } from "../store";
import {
  groupSpeechSegments,
  textToSpeechSegments,
  type SpeechBlock,
} from "../utils/tts/speech-text";
import { createAudioQueue, type AudioQueue } from "../utils/tts/audio-queue";
import {
  speakStream,
  type SpeakStreamHandlers,
} from "../utils/tts/speak-stream";

export interface FeedListenItem {
  id: string;
  title: string;
  sourceHost: string;
  imageUrl: string | null;
  script: string;
}

export interface FeedListenState {
  session: { items: FeedListenItem[]; index: number } | null;
  status: "idle" | "preparing" | "playing" | "paused" | "error";
  progress: { current: number; total: number } | null;
  skipped: number;
  error?: string;
}

export interface FeedListenCallbacks {
  /** 条目切换（含开场那一次）—— 宿主用它做右栏跟随。 */
  onItemChanged?: (id: string) => void;
  /** 条目自然播完 —— 宿主用它写已读。 */
  onItemFinished?: (id: string) => void;
  /** 会话因外部原因不可继续（引擎失败 / 上下文建不起来）—— 宿主用它弹全局提示。 */
  onAborted?: (error: string) => void;
}

export interface FeedListenDeps {
  speak: (text: string, handlers: SpeakStreamHandlers) => () => void;
  createContext: () => AudioContext;
  createQueue: (createContext: () => AudioContext) => AudioQueue;
  setState: (patch: Partial<FeedListenState>) => void;
}

export interface FeedListenController {
  getState(): FeedListenState;
  /**
   * 开一场会话。返回值是「有没有真开起来」：
   * - `"empty"`：一条可播的都没有（宿主据此提示空态）；
   * - `"failed"`：上下文建不起来，已经 abort 过（错误经 `onAborted` 上报）；
   * - `"started"`：已开播。
   * 可用与否只在这里判一次 —— 宿主不再自己复制一套「什么叫可播」。
   */
  start(
    items: FeedListenItem[],
    callbacks?: FeedListenCallbacks,
  ): FeedListenStartResult;
  toggle(): void;
  next(): void;
  prev(): void;
  stop(): void;
}

export type FeedListenStartResult = "started" | "empty" | "failed";

const IDLE: FeedListenState = {
  session: null,
  status: "idle",
  progress: null,
  skipped: 0,
  // 显式带上：`set({ ...IDLE })` 是浅合并，漏了它上一次的错误串会留在 state 里
  error: undefined,
};

export function createFeedListenController(
  deps: FeedListenDeps,
): FeedListenController {
  let state: FeedListenState = { ...IDLE };
  /** 会话快照：条目 + 预计算的块列表 + 切句总数。 */
  type ReadyItem = FeedListenItem & {
    blocks: SpeechBlock[];
    sentences: number;
  };
  let items: ReadyItem[] = [];
  /**
   * 合成游标（内部）：下一个要合成的条目。
   *
   * 它**不是**对外的「当前条目」—— 合成比播放快（RTF ≈ 0.67，队列又是入队即排期，
   * 没有背压），拿它当显示会出现「卡片写着第 7 条、耳朵里还是第 5 条」。
   */
  let index = 0;
  /** 播放游标（对外）：正在出声的那一条。进度、跟随、已读都以它为准。 */
  let displayIndex = 0;
  let blockAt = 0;
  /**
   * 会话内每块一个**单调递增**的全局序号 —— 队列按**播放时刻**把它报回来。
   *
   * 为什么不能用条目内的句号：每条都从 0 重来，队列的 `announced` 去重会把第 2 条
   * 之后的进度全吞掉（真机症状：进度卡在第 1 条）；而且跨条目没法判断「这声属于谁」。
   */
  let schedule: Array<{
    itemIndex: number;
    sentenceStart: number;
    sentences: number;
  }> = [];
  let callbacks: FeedListenCallbacks = {};
  let generation = 0;
  /** 本场是否已经播出过声音 —— 决定失败是「停会话」还是「跳过这一条」。 */
  let playedAny = false;
  let context: AudioContext | null = null;
  let queue: AudioQueue | null = null;
  const cancels = new Set<() => void>();

  const set = (patch: Partial<FeedListenState>) => {
    state = { ...state, ...patch };
    deps.setState(patch);
  };

  const releaseContext = () => {
    const live = context;
    context = null;
    queue = null;
    if (live) void live.close();
  };

  /** 会话不可继续：停音频、放掉上下文、置错误态，并让宿主弹提示。 */
  const abortSession = (error: string) => {
    generation += 1;
    for (const cancel of cancels) cancel();
    cancels.clear();
    queue?.stop();
    releaseContext();
    set({ session: null, status: "error", progress: null, error });
    callbacks.onAborted?.(error);
  };

  const reset = () => {
    generation += 1;
    for (const cancel of cancels) cancel();
    cancels.clear();
    queue?.stop();
    releaseContext();
    items = [];
    index = 0;
    displayIndex = 0;
    blockAt = 0;
    schedule = [];
    callbacks = {};
    playedAny = false;
    set({ ...IDLE });
  };

  /**
   * 建队列（幂等）。返回 null 表示上下文建不起来、已经 abort 过了 ——
   * Chromium 在 AudioContext 数量达到上限时 `new AudioContext()` 会抛。
   */
  const ensureQueue = (): AudioQueue | null => {
    if (queue) return queue;
    // context 一场只建一个：next / prev 会把队列丢掉重建，但复用同一个 context。
    if (!context) {
      try {
        context = deps.createContext();
      } catch (error) {
        abortSession(error instanceof Error ? error.message : String(error));
        return null;
      }
    }
    const captured = context;
    queue = deps.createQueue(() => captured);
    // 逐句进度：队列按**播放时刻**报句（不是入队时刻），所以进度条不会跑到声音前面。
    queue.onSentenceStart((globalBlock) => {
      const at = schedule[globalBlock];
      if (!at || !state.session) return;
      // 逐句进度：按播放时刻（与消息朗读同口径）
      set({ progress: { current: at.sentenceStart, total: at.sentences } });
      // 条目切换同样落在播放时刻：卡片、右栏跟随、已读都跟「正在出声的那一条」
      if (at.itemIndex !== displayIndex) {
        const previous = items[displayIndex];
        displayIndex = at.itemIndex;
        const current = items[displayIndex];
        if (!current) return;
        if (previous) callbacks.onItemFinished?.(previous.id);
        set({ session: { items: snapshot(), index: displayIndex } });
        callbacks.onItemChanged?.(current.id);
      }
    });
    queue.onDrained(() => {
      // 播空 = 最后一条也真的播完了：这时才写它的已读（stop() 走的是另一条路）
      const last = items[displayIndex];
      if (last) callbacks.onItemFinished?.(last.id);
      reset();
    });
    return queue;
  };

  /** 全场收尾：只在最后一块**合成结束、块已入队之后**调（markLast 会同步触发 drained）。 */
  const finish = () => {
    ensureQueue()?.markLast();
  };

  const snapshot = () => items.map((item) => ({ ...item }));

  /** 从某条头部开始播（开场 / next / prev 共用）。`stayPaused`：切条前是暂停态。 */
  const playFrom = (itemIndex: number, token: number, stayPaused = false) => {
    // 用户主动跳（开场 / next / prev）：显示立刻跟过去，不等播放事件
    index = itemIndex;
    displayIndex = itemIndex;
    blockAt = 0;
    schedule = [];
    const target = items[itemIndex]!;
    // next / prev 会把旧队列丢掉（queue = null）—— 这里重建队列、复用同一个 context。
    if (!ensureQueue()) return; // 上下文建不起来：已经 abort 过了
    set({
      session: { items: snapshot(), index },
      status: "preparing",
      progress: { current: 0, total: target.sentences },
    });
    callbacks.onItemChanged?.(target.id);
    if (stayPaused) {
      // 用户本来就是暂停着切条的：新条目也挂起，别自作主张开始听
      queue?.pause();
      set({ status: "paused" });
    }
    pump(token);
  };

  const failItem = (error: string, token: number) => {
    if (!playedAny) {
      // 开场就失败：多半是引擎不可用（未装模型 / 加载失败）。停会话让用户看见，
      // 而不是把整场静默跳完、零声音。
      abortSession(error);
      return;
    }
    // 已经播出过声音：当作这一条稿子坏了，跳过继续；末条也走这里 → 收尾。
    set({ skipped: state.skipped + 1 });
    if (advanceItem()) pump(token);
  };

  /** 切到下一条；没有下一条就收尾。返回是否还有条目可播。 */
  /** 只推进**合成**游标；对外的显示/跟随/已读由 `onSentenceStart` 在播放时刻切换。 */
  const advanceItem = (): boolean => {
    index += 1;
    blockAt = 0;
    if (index >= items.length) {
      finish();
      return false;
    }
    return true;
  };

  const pump = (token: number): void => {
    const currentItem = items[index];
    if (!currentItem) return;
    const block = currentItem.blocks[blockAt];
    if (!block) return;
    let sawChunk = false;
    let cancel: (() => void) | null = null;
    const forget = () => {
      if (cancel) cancels.delete(cancel);
    };

    const endBlock = () => {
      const isLastBlock = blockAt + 1 >= currentItem.blocks.length;
      if (!isLastBlock) {
        blockAt += 1;
        pump(token);
        return;
      }
      // 这一条的**合成**完了，不是播完了：写已读/切显示都等队列在播放时刻报回来
      // （`onSentenceStart`），否则卡片会跑在耳朵前面。
      if (!advanceItem()) return;
      pump(token);
    };

    // 这一块的全局序号（整个会话单调递增）：先登记，再拿它入队
    const globalBlock = schedule.length;
    schedule.push({
      itemIndex: index,
      sentenceStart: block.sentenceStart,
      sentences: currentItem.sentences,
    });

    cancel = deps.speak(block.text, {
      onChunk: (chunk) => {
        if (token !== generation) return;
        sawChunk = true;
        playedAny = true;
        ensureQueue()?.enqueue({
          sentenceIndex: globalBlock,
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
        failItem(error, token);
      },
    });
    cancels.add(cancel);
  };

  return {
    getState: () => state,
    start(nextItems, nextCallbacks) {
      reset();
      const usable: ReadyItem[] = [];
      for (const next of nextItems) {
        const segments = textToSpeechSegments(next.script).filter(
          (segment) => segment.text.trim().length > 0,
        );
        const blocks = groupSpeechSegments(segments);
        if (blocks.length === 0) continue;
        usable.push({ ...next, blocks, sentences: segments.length });
      }
      if (usable.length === 0) return "empty";
      items = usable;
      callbacks = nextCallbacks ?? {};
      const token = generation;
      const first = items[0]!;
      // 队列与 context 在会话一开始就建：否则 preparing 期间按「暂停」会丢事件
      // （那时还没有队列可挂起，而首块到达后 status 已经不是 preparing 了）。
      if (!ensureQueue()) return "failed"; // 上下文建不起来：已经 abort 过了
      set({
        session: { items: snapshot(), index: 0 },
        status: "preparing",
        progress: { current: 0, total: first.sentences },
        skipped: 0,
      });
      callbacks.onItemChanged?.(first.id);
      pump(token);
      return "started";
    },
    toggle() {
      // preparing 也算可暂停：队列在会话一开始就建好了，挂起它之后首块到达也不会出声。
      if (state.status === "playing" || state.status === "preparing") {
        queue?.pause();
        set({ status: "paused" });
        return;
      }
      if (state.status === "paused") {
        queue?.resume();
        set({ status: "playing" });
      }
    },
    next() {
      if (!state.session) return;
      // 暂停时按「下一条」就保持暂停：用户没说要开始听
      const wasPaused = state.status === "paused";
      // 立即停掉已排期的音频（不先用旧音频垫场），并让在飞的旧回调失效。
      generation += 1;
      for (const cancel of cancels) cancel();
      cancels.clear();
      queue?.stop();
      queue = null;
      if (index + 1 >= items.length) {
        // 末条没有「下一条」：等于结束会话（UI 上这颗按钮已置灰）
        reset();
        return;
      }
      playFrom(index + 1, generation, wasPaused);
    },
    prev() {
      if (!state.session || index === 0) return;
      const wasPaused = state.status === "paused";
      generation += 1;
      for (const cancel of cancels) cancel();
      cancels.clear();
      queue?.stop();
      queue = null;
      playFrom(index - 1, generation, wasPaused);
    },
    stop() {
      reset();
    },
  };
}

function defaultDeps(): FeedListenDeps {
  return {
    speak: (text, handlers) => speakStream(text, undefined, handlers),
    createContext: () => new AudioContext(),
    createQueue: (createContext) => createAudioQueue({ createContext }),
    setState: (patch) => useAppStore.getState().setFeedListen(patch),
  };
}

/** 全应用一个实例 —— 两场收听叠加没有意义，两条队列却是真实的内存。 */
let singleton: FeedListenController | null = null;

export function feedListenController(): FeedListenController {
  singleton ??= createFeedListenController(defaultDeps());
  return singleton;
}

/** 测试用：换掉单例，避免 jsdom 里真的建 AudioContext。 */
export function setFeedListenControllerForTests(
  next: FeedListenController | null,
): void {
  singleton = next;
}

export function stopFeedListen(): void {
  feedListenController().stop();
}

export function useFeedListen(): FeedListenState & { stop: () => void } {
  const state = useAppStore((s) => s.feedListen);
  return { ...state, stop: stopFeedListen };
}

/**
 * 收听与其它音频互斥的守卫：宿主挂一次就够。
 *
 * 1. 消息朗读开始 → 停收听（订阅 store，一处覆盖所有朗读入口）；
 * 2. 语音模式打开 → 停收听（与 `useVoiceMode` 停朗读是同一件事的另一半）。
 */
export function useFeedListenInterrupts(): void {
  useEffect(() => {
    const unsubReadAloud = useAppStore.subscribe((state, prev) => {
      if (
        prev.readAloud.status === "idle" &&
        state.readAloud.status !== "idle"
      ) {
        stopFeedListen();
      }
    });
    const unsubVoice = useAppStore.subscribe((state, prev) => {
      if (!prev.voiceModeOpen && state.voiceModeOpen) stopFeedListen();
    });
    return () => {
      unsubReadAloud();
      unsubVoice();
    };
  }, []);
}
