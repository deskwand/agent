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
import { isTurnComplete } from "../utils/voice/turn-heuristic";
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
  sendQuestion(text: string): void;
  /** 硬上限：静音这么久就放弃等，直接收尾。不再当"说完了"的判据。 */
  silenceMs: number;
  /** 本轮 ASR 的实时 partial。判"说完了吗"用。 */
  currentPartial(): string;
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
   * 「本轮被我们打断过」的标记。判决在 `done` 到达时做（见 `finishRound`）。
   *
   * 只存一个布尔值，不存偏移：偏移在判决那一刻从 `lastSentenceStart` 取
   * ——那才是精确值。在打断的那一瞬间还不知道当前句是哪句。
   */
  let interrupted = false;
  /** 本轮已收到的累计文本。恢复时以它为准，因为 LLM 可能已经说完了。 */
  let answerText = "";
  /** 当前正在念的那一句在 `answerText` 里的起始偏移。 */
  let lastSentenceStart = 0;
  /**
   * 静音之后的等待计时器。
   *
   * **只有它一个计时器**：判定说"没说完"之后靠它收尾，判决（打断要不要撤销）
   * 挂在 `done` 上。多一个计时器就是多一个和 `done` 赛跑的选手。
   */
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;

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
    clearPrefetch();
  };

  const finishRound = (text: string, discarded: boolean) => {
    const transcript = text.trim();
    endRound();

    // 打断之后：识别出的是附和（或什么都没识别出）就撤销这次打断。
    // 判决放在这里而不是另设计时器：done 是本轮唯一的终点，等它到就有了
    // 全部输入，不需要第三个计时器去和它赛跑。
    if (interrupted) {
      interrupted = false;
      if (discarded || transcript.length === 0 || isBackchannel(transcript)) {
        // 该句重头念：重念几个字比丢字好。
        deps.speech.begin(lastSentenceStart);
        deps.speech.push(answerText);
        answering = true;
        setBargeIn(true);
        setState("speaking");
        return;
      }
    }

    if (discarded || transcript.length === 0) {
      setState(idleState());
      return;
    }
    deps.onQuestion(transcript);
    deps.sendQuestion(transcript);
    deps.speech.begin();
    // 答案作废：累计文本与断点一起归零，否则下一次打断会拿旧值恢复。
    answerText = "";
    lastSentenceStart = 0;
    answering = true;
    setBargeIn(true);
    setState("thinking");
  };

  const failRound = (code: VoiceErrorCode) => {
    deps.onError(code);
    endRound();
    answering = false;
    setBargeIn(false);
    setState(idleState());
  };

  const beginRound = async () => {
    if (sessionId) {
      // 上一轮还在收尾（stop 已发、done 未到）。用户又开口说明这是新的一轮：
      // 丢掉那条未完成的收尾，重开一条会话。不这么做的话，新音频会推给一条
      // 已经 closed 的流（静默丢弃），这一轮的话就白说了。
      //
      // 这里**只清 sessionId**：不动 vad、不清回补缓冲 —— 用户已经在说话了，
      // vad 的 speaking 状态是对的，而回补缓冲里正是这句话的开头。
      void deps.voice.cancel(sessionId);
      sessionId = null;
    }
    const started = await deps.voice.start();
    if (disposed) {
      if (started.ok) void deps.voice.cancel(started.sessionId);
      return;
    }
    if (!started.ok) {
      failRound(started.code);
      return;
    }
    sessionId = started.sessionId;
    deps.speech.stop();
    answering = false;
    setBargeIn(false);
    setState("capturing");
    for (const frame of prefetch)
      void deps.voice.pushAudio(started.sessionId, frame);
    clearPrefetch();
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

  /** 本轮到此为止：关会话，等 ASR 的 done。 */
  const closeTurn = () => {
    clearSilenceTimer();
    if (sessionId) void deps.voice.stop(sessionId);
  };

  const onVadEdge = (edge: VadEdge) => {
    speaking = edge === "speech-start";
    if (blocked) return;
    if (edge === "speech-start") {
      // 继续说：等待计时重置，会话接着用。
      clearSilenceTimer();
      if (answering) {
        deps.speech.stop();
        // 只立标记，不算偏移：当前句是哪句要到判决时才知道。
        interrupted = true;
      } else {
        // 上一轮可能留下了一个标记（比如打断之后那一轮报错收尾，没走到判决）。
        // 不清的话，这一轮的 done 会被当成"刚被打断"，去恢复念一段早就作废的
        // 答案。
        interrupted = false;
      }
      answering = false;
      void beginRound();
      return;
    }

    // 静音了。先问一句"说完了吗"再决定关不关。
    if (!sessionId) return;
    if (isTurnComplete(deps.currentPartial())) {
      closeTurn();
      return;
    }
    // 还没说完：保持会话打开，等继续说；最多等到硬上限。
    clearSilenceTimer();
    // 用全局 setTimeout 而不是 window.setTimeout：本模块的测试跑在 Node 环境
    // （没有 window），而它的设计原则就是"不碰 DOM"。
    silenceTimer = setTimeout(() => {
      silenceTimer = null;
      closeTurn();
    }, deps.silenceMs);
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

  deps.speech.onSentence((index, text) => {
    // 当前句的起始偏移 = 它在累计文本里的位置。到下一句开始时，本句就算念完了。
    const at = answerText.indexOf(text);
    if (at >= 0) lastSentenceStart = at;
    deps.onSentence(index, text);
  });
  deps.speech.onDrained(() => {
    if (!answering) return;
    answering = false;
    // 朗读播完就回到接收期：阈值与确认时长都要恢复，否则用户接话时
    // 还要按"打断朗读"的严格门槛才被听见。
    setBargeIn(false);
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
      unsubscribe();
      clearSilenceTimer();
      capture?.stop();
      capture = null;
      // 在 unsubscribe 之后：monitor.stop 可能报一个 speech-end，
      // 而那已经不关我们的事了。
      deps.monitor.stop();
      if (sessionId) void deps.voice.cancel(sessionId);
      deps.speech.stop();
      endRound();
      answering = false;
      setState("stopped");
    },
    setBlocked(next) {
      if (blocked === next) return;
      blocked = next;
      if (next) {
        deps.speech.stop();
        answering = false;
        // 压缩期也要把打断门槛收回去：不收的话，压缩结束后用户接话还得
        // 按“打断朗读”的严格标准才被听见。
        setBargeIn(false);
        // 硬上限计时也必须停：不停的话它到期会关掉会话、把问题发出去，
        // 而压缩期就是不该发新问题。
        clearSilenceTimer();
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
      answerText = fullText;
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
