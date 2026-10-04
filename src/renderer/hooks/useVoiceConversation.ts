/**
 * @module renderer/hooks/useVoiceConversation
 *
 * 语音模式的轮次状态机。
 *
 * 它不读 store、不碰 DOM：ASR 事件、回复增量、发送动作全部从 deps 进来。
 * 这样才能用假事件序列把四条难路径（打断、空识别、压缩期、报错）测完。
 *
 * 校准不依赖时钟：每片音频固定 100ms（mic-capture 的节拍），数片数就行。
 */
import type {
  VoiceErrorCode,
  VoiceEvent,
  VoiceStartResult,
} from "../../shared/ipc-types";
import {
  BARGE_IN_THRESHOLD_MARGIN,
  createVad,
  DEFAULT_SPEECH_MS,
  estimateNoiseFloor,
  thresholdFromNoiseFloor,
  type Vad,
} from "../utils/voice/vad";
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

export interface ConversationDeps {
  startCapture(
    onSamples: (pcm: Int16Array, level: number) => void,
  ): Promise<MicCapture>;
  voice: VoiceBridge;
  speech: StreamingSpeech;
  sendQuestion(text: string): void;
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

/** 每片音频的时长。mic-capture 每 100ms 交一片。 */
export const FRAME_MS = 100;
export const CALIBRATION_MS = 800;
/** 说话起点回补的音频长度：避免切掉开头的半个字。 */
export const PREFETCH_MS = 500;

/**
 * 回答期的「说话起点」确认时长，比默认的 150ms 高一倍。
 *
 * 这一时期开口的后果是把朗读掐断：念到一半被截断比晚 150ms 响应更伤。
 * 而咳嗽、关门、拖椅子这类突发噪声的持续时长常常刚过 150ms ——
 * 拿主动开口的阈值去判打断，必然过度触发。
 */
export const BARGE_IN_SPEECH_MS = 300;
const PREFETCH_BYTES = 16000 * 2 * (PREFETCH_MS / 1000);

export function createVoiceConversation(
  deps: ConversationDeps,
): VoiceConversation {
  let state: ConversationState = "calibrating";
  let capture: MicCapture | null = null;
  let sessionId: string | null = null;
  let disposed = false;
  let blocked = false;
  let vad: Vad | null = null;
  let calibrationMs = 0;
  let answering = false;
  const calibrationLevels: number[] = [];
  const prefetch: ArrayBuffer[] = [];
  let prefetchBytes = 0;

  const setState = (next: ConversationState) => {
    if (state === next) return;
    state = next;
    deps.onState(next);
  };

  const idleState = (): ConversationState =>
    blocked ? "blocked" : "listening";

  /** 标定得出的阈值。回答期要在它之上再加一档。 */
  let calibratedThreshold = 0;

  /**
   * 回答期：起点确认更长、阈值更高。**两个都要调** ——
   * 时长挡的是"咳嗽、关门"这类短促噪声，阈值挡的是"扬声器残留、混响"
   * 这类识别不出内容的弱信号。只调其中一个，另一种照样会打断朗读。
   */
  const setBargeIn = (on: boolean) => {
    if (!vad) return;
    vad.setSpeechMs(on ? BARGE_IN_SPEECH_MS : DEFAULT_SPEECH_MS);
    vad.setThreshold(
      on
        ? calibratedThreshold + BARGE_IN_THRESHOLD_MARGIN
        : calibratedThreshold,
    );
  };

  const clearPrefetch = () => {
    prefetch.length = 0;
    prefetchBytes = 0;
  };

  const endRound = () => {
    sessionId = null;
    vad?.reset();
    clearPrefetch();
  };

  const finishRound = (text: string, discarded: boolean) => {
    const transcript = text.trim();
    endRound();
    if (discarded || transcript.length === 0) {
      setState(idleState());
      return;
    }
    deps.onQuestion(transcript);
    deps.sendQuestion(transcript);
    deps.speech.begin();
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
    if (disposed) return;
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

  const onSamples = (pcm: Int16Array, level: number) => {
    deps.onLevel(level);

    if (!vad) {
      calibrationMs += FRAME_MS;
      calibrationLevels.push(level);
      if (calibrationMs >= CALIBRATION_MS) {
        calibratedThreshold = thresholdFromNoiseFloor(
          estimateNoiseFloor(calibrationLevels),
        );
        vad = createVad({
          threshold: calibratedThreshold,
          silenceMs: deps.silenceMs,
        });
        setState(idleState());
      }
      return;
    }

    const wasSpeaking = vad.isSpeaking();
    const event = vad.push(level, FRAME_MS);

    if (blocked) {
      if (event === "silence") vad.reset();
      return;
    }

    if (event === "speech-start") {
      if (answering) deps.speech.stop();
      answering = false;
      // **不要在这里 clearPrefetch()**：回补缓冲正是给即将建立的会话用的，
      // beginRound 末尾才该清。早清一步，PREFETCH_MS 就完全失效。
      void beginRound();
      return;
    }

    if (event === "silence") {
      if (sessionId) void deps.voice.stop(sessionId);
      return;
    }

    if (sessionId && wasSpeaking) {
      const buffer = pcm.buffer.slice(
        pcm.byteOffset,
        pcm.byteOffset + pcm.byteLength,
      ) as ArrayBuffer;
      void deps.voice.pushAudio(sessionId, buffer);
      return;
    }

    // 还没开始说话：只存回补缓冲
    const buffer = pcm.buffer.slice(
      pcm.byteOffset,
      pcm.byteOffset + pcm.byteLength,
    ) as ArrayBuffer;
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

  deps.speech.onSentence(deps.onSentence);
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
      try {
        capture = await deps.startCapture(onSamples);
      } catch (error) {
        deps.onError("VOICE_CAPTURE_FAILED");
        setState("blocked");
        return;
      }
      if (disposed) capture.stop();
    },
    stop() {
      disposed = true;
      unsubscribe();
      capture?.stop();
      capture = null;
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
        setState("blocked");
        return;
      }
      // 解封要把 VAD 一起复位：压缩期间的事件被丢掉，但 vad 内部的 speaking
      // 状态还留着 —— 不复位的话用户得先静音满一个窗口，才能再次触发说话起点。
      vad?.reset();
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
