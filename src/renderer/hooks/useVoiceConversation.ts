/**
 * @module renderer/hooks/useVoiceConversation
 *
 * 语音模式的轮次状态机。
 *
 * 它不读 store、不碰 DOM：VAD 边沿、ASR 事件、回复增量、发送动作全部从 deps
 * 进来。这样才能用假事件序列把四条难路径（打断、空识别、压缩期、报错）测完。
 *
 * **VAD 不在这里算**：它在主进程（`main/voice/vad-engine.ts`，Silero 模型）。
 * 这里只消费 `speech-start` / `speech-end` 两个边沿。原来那套「能量阈值 +
 * 噪声底标定」已删 —— 它的三个手调余量都是在补偿模型精度不足。
 */
import type {
  VadEdge,
  VadProfile,
  VoiceErrorCode,
  VoiceEvent,
  VoiceStartResult,
} from "../../shared/ipc-types";
import { isBackchannel } from "../utils/voice/backchannel";
import type { MicCapture } from "../utils/voice/mic-capture";
import type { StreamingSpeech } from "./useStreamingSpeech";

export type ConversationState =
  | "calibrating"
  | "listening"
  | "capturing"
  | "thinking"
  | "speaking"
  | "blocked"
  /** 已收尾：麦克风已释放。与 blocked（压缩中）是两回事，别混。 */
  | "stopped";

export interface VoiceBridge {
  start(): Promise<VoiceStartResult>;
  pushAudio(sessionId: string, pcm: ArrayBuffer): Promise<void>;
  stop(sessionId: string): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  onEvent(cb: (event: VoiceEvent) => void): () => void;
}

/**
 * 主进程的语音活动监测。
 *
 * 与 `voice` 分开：它不带 sessionId —— VAD 的生命周期是**语音模式**，
 * 不是单条录音。朗读期没有 ASR 会话，而那时正是要判断"用户开口没有"的时刻。
 */
export interface VoiceMonitor {
  start(): void;
  audio(pcm: Int16Array): void;
  profile(profile: VadProfile): void;
  reset(): void;
  stop(): void;
}

export interface ConversationDeps {
  startCapture(
    onSamples: (pcm: Int16Array, level: number) => void,
  ): Promise<MicCapture>;
  voice: VoiceBridge;
  monitor: VoiceMonitor;
  speech: StreamingSpeech;
  /**
   * 把识别出来的问题发出去。返回 false = 宿主没收下（例如语音模式已关），
   * 这时不能再开一条没人铺答案的朗读。
   */
  sendQuestion(text: string): boolean;
  /** 静音这么久就认为这一轮说完了，收尾。 */
  silenceMs: number;
  onState(state: ConversationState): void;
  onLevel(level: number): void;
  onTranscript(text: string): void;
  onQuestion(text: string): void;
  onSentence(index: number, text: string): void;
  onError(code: VoiceErrorCode): void;
}

export interface VoiceConversation {
  start(): Promise<void>;
  stop(): void;
  setBlocked(blocked: boolean): void;
  sendAnswerDelta(fullText: string, ended: boolean): void;
  state(): ConversationState;
}

/** 说话起点回补的音频长度：避免切掉开头的半个字。 */
export const PREFETCH_MS = 500;
const PREFETCH_BYTES = 16000 * 2 * (PREFETCH_MS / 1000);

export function createVoiceConversation(
  deps: ConversationDeps,
): VoiceConversation {
  let state: ConversationState = "calibrating";
  let capture: MicCapture | null = null;
  let sessionId: string | null = null;
  let disposed = false;
  let blocked = false;
  let answering = false;
  const prefetch: ArrayBuffer[] = [];
  let prefetchBytes = 0;
  /** VAD 说了算。渲染层不再自己算。 */
  let speaking = false;
  /**
   * 「这一轮的 ASR 是在回答播放期间开的」——也就是打断候选。
   *
   * 候选身份只看**开口时**播放有没有在进行：持续说话（一次次 speech-start）
   * 不改变它。判决在 `done` 到达时做（见 `finishRound`）。
   */
  let candidate = false;
  /**
   * 静音之后的等待计时器。
   *
   * **只有它一个计时器**：判定说"没说完"之后靠它收尾，判决（打断要不要撤销）
   * 挂在 `done` 上。多一个计时器就是多一个和 `done` 赛跑的选手。
   */
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  /** 静音等待的截止时刻。会话还在启动时也要记住它，否则启动完成就没人收尾了。 */
  let silenceDeadline: number | null = null;
  /** stop 已发、done 未到。这段时间里音频送进去也没人收，用户再开口要换会话。 */
  let closing = false;
  /** voice.start 还没解析。重复的起点不能开两条会话。 */
  let starting = false;
  /**
   * 轮次代次。停止和压缩会让它自增，用来作废迟到的启动结果：
   * 那个会话已经没人认领，必须由它自己取消掉。
   */
  let roundGeneration = 0;

  const setState = (next: ConversationState) => {
    if (state === next) return;
    state = next;
    deps.onState(next);
  };

  const idleState = (): ConversationState =>
    blocked ? "blocked" : "listening";

  /**
   * 换回答期的灵敏度档。
   *
   * 它在渲染层，因为"是不是回答期"只有渲染层知道（`answering`）。
   * 具体调什么参数在主进程的 `vad-engine.ts` 里。
   */
  const setBargeIn = (on: boolean) => {
    deps.monitor.profile(on ? "barge-in" : "interactive");
  };

  const clearPrefetch = () => {
    prefetch.length = 0;
    prefetchBytes = 0;
  };

  const endRound = () => {
    sessionId = null;
    closing = false;
    clearPrefetch();
  };

  const finishRound = (text: string, discarded: boolean) => {
    const transcript = text.trim();
    const wasCandidate = candidate;
    candidate = false;
    endRound();

    // 候选被否：说话声（咳嗽、键盘、附和词）不该影响正在播的回答。
    // 什么都不用恢复 —— 播放从来没被打断过。
    if (
      wasCandidate &&
      (discarded || transcript.length === 0 || isBackchannel(transcript))
    ) {
      if (answering) return; // 还在播：状态和播放都别动
      setBargeIn(false);
      setState(idleState());
      return;
    }

    if (discarded || transcript.length === 0) {
      setState(idleState());
      return;
    }
    // 确认打断：旧回答的播放到此为止，它后面的增量也不再出声。
    deps.speech.stop();
    if (!deps.sendQuestion(transcript)) {
      answering = false;
      setBargeIn(false);
      setState(idleState());
      return;
    }
    deps.onQuestion(transcript);
    deps.speech.begin();
    answering = true;
    setBargeIn(true);
    setState("thinking");
  };

  const failRound = (code: VoiceErrorCode) => {
    deps.onError(code);
    const wasCandidate = candidate;
    candidate = false;
    endRound();
    if (wasCandidate && answering) return; // 候选失败，播放照旧
    answering = false;
    setBargeIn(false);
    setState(idleState());
  };

  /**
   * 回补缓冲送进某条会话。它是"不切掉开头半个字"的唯一保障，
   * 而新会话和复用会话两条路都要走它。
   */
  const replayPrefetch = (id: string) => {
    for (const frame of prefetch) void deps.voice.pushAudio(id, frame);
    clearPrefetch();
  };

  const beginRound = async () => {
    if (starting) return;
    starting = true;
    const generation = roundGeneration;
    const started = await deps.voice.start();
    starting = false;
    if (disposed || generation !== roundGeneration) {
      // 停止或压缩让这次启动作废：那条会话已经没人认领，
      // 不取消的话它会一直挂着等音频。
      if (started.ok) void deps.voice.cancel(started.sessionId);
      return;
    }
    if (!started.ok) {
      failRound(started.code);
      return;
    }
    sessionId = started.sessionId;
    closing = false;
    if (candidate) {
      // 候选收音只是同时在听：播放、音量档位和状态都不动。
      // 回答已经播完的候选才需要一个收音态。
      if (!answering) setState("capturing");
    } else {
      deps.speech.stop();
      answering = false;
      setBargeIn(false);
      setState("capturing");
    }
    replayPrefetch(started.sessionId);
    // 启动期间用户已经说完了：按剩下的静音时长收尾，
    // 不能等他再开一次口才发现这句话没交出去。
    if (!speaking && silenceDeadline !== null) {
      const remaining = silenceDeadline - Date.now();
      if (remaining <= 0) closeTurn();
      else scheduleSilenceClose(remaining);
    }
  };

  /**
   * VAD 边沿。主进程报的，不是本地算的。
   *
   * 回补缓冲在这里**不清** —— 它正是给即将建立的会话用的，`beginRound`
   * 末尾才该清。早清一步，`PREFETCH_MS` 就完全失效。
   */
  const clearSilenceTimer = () => {
    if (silenceTimer !== null) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  };

  const scheduleSilenceClose = (delay: number) => {
    clearSilenceTimer();
    // 用全局 setTimeout 而不是 window.setTimeout：本模块的测试跑在 Node 环境
    // （没有 window），而它的设计原则就是"不碰 DOM"。
    silenceTimer = setTimeout(() => {
      silenceTimer = null;
      closeTurn();
    }, delay);
  };

  /** 本轮到此为止：关会话，等 ASR 的 done。重复调用只关一次。 */
  const closeTurn = () => {
    clearSilenceTimer();
    silenceDeadline = null;
    if (!sessionId || closing || disposed || blocked) return;
    closing = true;
    void deps.voice.stop(sessionId);
  };

  const onVadEdge = (edge: VadEdge) => {
    speaking = edge === "speech-start";
    if (blocked) return;
    if (edge === "speech-start") {
      // 继续说：等待计时重置，会话接着用。
      clearSilenceTimer();
      silenceDeadline = null;
      if (sessionId && !closing) {
        // 续说：同一条会话接着收音频。停顿里的那些片只进了回补缓冲
        // （speaking 已是 false），补不进去就等于把这句话的开头丢掉。
        //
        // **候选身份在这里不变**：它由"这一轮开口时播放有没有在进行"定，
        // 中途播放播完也不改判 —— 否则一句说到一半就变成普通提问，
        // 后面的"嗯"会被当成新问题发出去。
        replayPrefetch(sessionId);
        return;
      }
      // 会话还在启动：它建立后自己会把回补缓冲补上。
      if (starting) return;
      // 新的一轮：开口时播放进行中 = 打断候选，判决等最终识别结果；
      // 播放已经结束就是普通一轮。
      candidate = answering;
      if (sessionId) {
        // stop 已发、done 未到。用户又开口说明这是一轮新的话：
        // 丢掉那条未完成的收尾，重开一条会话。不这么做的话，新音频会推给一条
        // 已经 closed 的流（静默丢弃），这一轮的话就白说了。
        void deps.voice.cancel(sessionId);
        sessionId = null;
      }
      void beginRound();
      return;
    }

    // 静音了。统一等一个完整的静音时长：句末标点只说明这一句说完了，
    // 而"用户说完了"得由停顿来证明。
    if (!sessionId && !starting) return;
    silenceDeadline = Date.now() + deps.silenceMs;
    // 会话还没建立：等启动完成，再按剩余时间安排收尾。
    if (!sessionId || closing) return;
    scheduleSilenceClose(deps.silenceMs);
  };

  const toArrayBuffer = (pcm: Int16Array): ArrayBuffer =>
    pcm.buffer.slice(
      pcm.byteOffset,
      pcm.byteOffset + pcm.byteLength,
    ) as ArrayBuffer;

  const onSamples = (pcm: Int16Array, level: number) => {
    deps.onLevel(level);
    // 每一片都送给主进程的 VAD —— 包括安静的时候。它要连续地看音频，
    // 而且朗读期也在跑（那时没有 ASR 会话，正是要判断打断的时刻）。
    deps.monitor.audio(pcm);
    if (blocked) return;

    if (sessionId && speaking) {
      void deps.voice.pushAudio(sessionId, toArrayBuffer(pcm));
      return;
    }

    // 还没开始说话：只存回补缓冲
    const buffer = toArrayBuffer(pcm);
    if (prefetchBytes + buffer.byteLength <= PREFETCH_BYTES * 2) {
      prefetch.push(buffer);
      prefetchBytes += buffer.byteLength;
      while (prefetchBytes > PREFETCH_BYTES && prefetch.length > 1) {
        prefetchBytes -= prefetch.shift()!.byteLength;
      }
    }
  };

  const unsubscribe = deps.voice.onEvent((event) => {
    if (event.type === "install") return;
    // VAD 事件不带 sessionId，且必须在朗读期（无会话）也能收 ——
    // 所以它在下面那道 sessionId 过滤**之前**。
    if (event.type === "vad") {
      onVadEdge(event.edge);
      return;
    }
    if (!sessionId || event.sessionId !== sessionId) return;
    if (event.type === "partial") {
      deps.onTranscript(event.text);
      return;
    }
    if (event.type === "done") {
      finishRound(event.text, event.discarded);
      return;
    }
    failRound(event.code);
  });

  deps.speech.onSentence((index, text) => deps.onSentence(index, text));
  deps.speech.onDrained(() => {
    if (!answering) return;
    answering = false;
    // 朗读播完就回到接收期：阈值与确认时长都要恢复，否则用户接话时
    // 还要按"打断朗读"的严格门槛才被听见。
    setBargeIn(false);
    // 候选会话还开着：播完不等于这一轮结束 —— 识别结果还没到，
    // 这时收尾等于把用户刚说的那句话扔掉。
    if (sessionId) {
      if (!closing) setState("capturing");
      return;
    }
    setState(idleState());
  });

  return {
    async start() {
      deps.monitor.start();
      try {
        capture = await deps.startCapture(onSamples);
      } catch (error) {
        if (disposed) return;
        deps.onError("VOICE_CAPTURE_FAILED");
        setState("blocked");
        return;
      }
      if (disposed) {
        capture.stop();
        return;
      }
      // 标定那段代码删掉后，这一句就是唯一的"从 calibrating 出来"的出口。
      // 少了它，状态会一直停在 calibrating，直到用户第一次开口。
      setState(idleState());
    },
    stop() {
      disposed = true;
      roundGeneration += 1;
      unsubscribe();
      clearSilenceTimer();
      silenceDeadline = null;
      capture?.stop();
      capture = null;
      // 在 unsubscribe 之后：monitor.stop 可能报一个 speech-end，
      // 而那已经不关我们的事了。
      deps.monitor.stop();
      if (sessionId) void deps.voice.cancel(sessionId);
      deps.speech.stop();
      endRound();
      answering = false;
      candidate = false;
      setState("stopped");
    },
    setBlocked(next) {
      if (blocked === next) return;
      blocked = next;
      if (next) {
        deps.speech.stop();
        answering = false;
        candidate = false;
        // 压缩期也要把打断门槛收回去：不收的话，压缩结束后用户接话还得
        // 按“打断朗读”的严格标准才被听见。
        setBargeIn(false);
        // 计时也必须停：不停的话它到期会关掉会话、把问题发出去，
        // 而压缩期就是不该发新问题。代次同时作废在途的启动。
        roundGeneration += 1;
        clearSilenceTimer();
        silenceDeadline = null;
        setState("blocked");
        return;
      }
      // 解封要把 VAD 一起复位：压缩期间的事件被丢掉，但主进程那边内部的
      // speaking 状态还留着 —— 不复位的话用户得先静音满一个窗口，
      // 才能再次触发说话起点。
      deps.monitor.reset();
      speaking = false;
      setState(idleState());
    },
    sendAnswerDelta(fullText, ended) {
      if (!answering) return;
      // 空文本只用于「本轮没有可读内容」的收尾，不该让球切到朗读态。
      if (fullText.length > 0 && state === "thinking") setState("speaking");
      deps.speech.push(fullText);
      if (ended) deps.speech.end();
    },
    state() {
      return state;
    },
  };
}
