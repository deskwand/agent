/**
 * @module renderer/hooks/useVoiceMode
 *
 * 把纯逻辑编排器接上真实依赖：麦克风、voice IPC、流式朗读，以及从 store
 * 读「本轮回复文本」。
 *
 * **本轮结束怎么判**（这里最容易写错）：主信号是 partial 被清空 —— 助手消息
 * 一落库，store 就把该轮的 `partialByTurn` 清掉。只靠"文本静止 N 毫秒"是不行的：
 * 清空那一刻 `text !== lastAnswer` 先命中，永远走不到静止分支，于是尾句不读、
 * `speaking` 永远不结束。静止判定退成兜底，只管流式中断这类没有清空信号的场景。
 *
 * 还有一种没有任何可读文本的轮次（纯代码块回复）：partial 从头到尾都是空的，
 * 清空信号也不会有。所以再加一条：会话不再 running 且本轮没有任何文本时收尾。
 */
import { useEffect, useRef, useState } from "react";
import type { VoiceErrorCode } from "../../shared/ipc-types";
import { DEFAULT_VOICE_MODE } from "../../shared/voice-mode";
import { useAppStore } from "../store";
import { createAudioQueue } from "../utils/tts/audio-queue";
import { startMicCapture } from "../utils/voice/mic-capture";
import { stopReadAloud } from "./useReadAloud";
import { createStreamingSpeech } from "./useStreamingSpeech";
import {
  createVoiceConversation,
  type ConversationState,
  type VoiceConversation,
} from "./useVoiceConversation";

export interface VoiceModeView {
  state: ConversationState;
  level: number;
  transcript: string;
  answer: string;
  error: VoiceErrorCode | null;
}

export interface UseVoiceModeOptions {
  /**
   * 当前会话 id。**可以为 null**：欢迎页还没有会话，第一句语音会用
   * startSession 建一个（由 VoiceModeOverlay 注入的 onSendQuestion 决定）。
   */
  sessionId: string | null;
  isCompacting: boolean;
  /**
   * 把一轮问题发出去。由宿主注入 —— `continueSession` 是 useIPC 的返回值，
   * 不是 store action，放进 store 要多一层转发。
   */
  sendQuestion(text: string): void;
}

const EMPTY: VoiceModeView = {
  state: "calibrating",
  level: 0,
  transcript: "",
  answer: "",
  error: null,
};

/** 轮询间隔；静止阈值 5 × 120ms = 600ms。 */
const POLL_MS = 120;
const IDLE_TICKS_TO_END = 5;

/**
 * 本轮回复的实时全文。
 *
 * 取 partial 里最长的一条 —— 生成中只有当前轮的 partial 存在（上一轮落库时被清空），
 * 取最长只是防多轮并存，也避免依赖 Object.keys 的顺序。
 */
function readAnswer(sessionId: string): string {
  const partials =
    useAppStore.getState().sessionStates[sessionId]?.partialByTurn;
  if (!partials) return "";
  let best = "";
  for (const value of Object.values(partials)) {
    if (value.message.length > best.length) best = value.message;
  }
  return best;
}

function isSessionRunning(sessionId: string): boolean {
  return useAppStore
    .getState()
    .sessions.some((s) => s.id === sessionId && s.status === "running");
}

export function useVoiceMode(options: UseVoiceModeOptions): VoiceModeView {
  const [view, setView] = useState<VoiceModeView>(EMPTY);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const conversationRef = useRef<VoiceConversation | null>(null);

  useEffect(() => {
    const patch = (next: Partial<VoiceModeView>) =>
      setView((prev) => ({ ...prev, ...next }));

    // AudioContext 由这里创建并持有：`createStreamingSpeech` 的默认依赖每次都 new
    // 一个，而浮层每开一次就挂载一次 —— 不 close 就会一直漏。Chromium 对同时存在
    // 的 AudioContext 有上限，攒够了连 `new AudioContext` 都会抛。
    const audioContext = new AudioContext();
    const speech = createStreamingSpeech({
      speak: (text: string) => window.electronAPI.tts.speak(text),
      createQueue: () =>
        createAudioQueue({ createContext: () => audioContext }),
    });

    let lastAnswer = "";
    let idleTicks = 0;
    /** 本轮 ASR 的实时 partial。轮次判定要读它，而它只在本次 effect 里活着。 */
    let latestTranscript = "";
    /** 已就"本轮没有文本"收过尾，避免每 120ms 重复收一次。 */
    let closedEmpty = false;

    const conversation = createVoiceConversation({
      startCapture: startMicCapture,
      voice: {
        start: () => window.electronAPI.voice.start(),
        pushAudio: (id, pcm) => window.electronAPI.voice.pushAudio(id, pcm),
        stop: (id) => window.electronAPI.voice.stop(id),
        cancel: (id) => window.electronAPI.voice.cancel(id),
        onEvent: (cb) => window.electronAPI.voice.onEvent(cb),
      },
      monitor: {
        start: () => {
          void window.electronAPI.voice.monitorStart();
        },
        audio: (pcm) => {
          void window.electronAPI.voice.monitorAudio(
            pcm.buffer.slice(
              pcm.byteOffset,
              pcm.byteOffset + pcm.byteLength,
            ) as ArrayBuffer,
          );
        },
        profile: (profile) => {
          void window.electronAPI.voice.monitorProfile(profile);
        },
        reset: () => {
          void window.electronAPI.voice.monitorReset();
        },
        stop: () => {
          void window.electronAPI.voice.monitorStop();
        },
      },
      speech,
      sendQuestion: (text) => optionsRef.current.sendQuestion(text),
      silenceMs:
        useAppStore.getState().appConfig?.voiceMode?.silenceMs ??
        DEFAULT_VOICE_MODE.silenceMs,
      // ASR partial 不存在 store 里（store 的 partialByTurn 是**回答**的流式
      // 文本，readAnswer 读的就是它）。问题的 partial 只经过 onTranscript
      // 落在本 hook 的 state 里，所以用一个闭包变量回喂。
      currentPartial: () => latestTranscript,
      onState: (state) => patch({ state }),
      onLevel: (level) => patch({ level }),
      onTranscript: (transcript) => {
        latestTranscript = transcript;
        patch({ transcript });
      },
      onQuestion: () => {
        // 新一轮开始：清掉上一轮的字幕与错误，解除"空轮次已收尾"。
        patch({ transcript: "", answer: "", error: null });
        lastAnswer = "";
        idleTicks = 0;
        closedEmpty = false;
        latestTranscript = "";
      },
      onSentence: () => {},
      onError: (error) => patch({ error }),
    });

    conversationRef.current = conversation;
    stopReadAloud(); // 浮层一开就停掉消息朗读：两路音频不共存
    void conversation.start();

    const timer = window.setInterval(() => {
      const sessionId = optionsRef.current.sessionId;
      // 会话还没建起来（欢迎页的第一轮）：没有 partial 可读，也没有轮次要收尾。
      if (!sessionId) return;
      const text = readAnswer(sessionId);

      if (text !== lastAnswer) {
        // partial 被清空 = 这一轮已落库。**主路径的收尾信号**。
        if (text.length === 0) {
          if (lastAnswer.length > 0) {
            conversation.sendAnswerDelta(lastAnswer, true);
          }
          lastAnswer = "";
          idleTicks = 0;
          return;
        }
        lastAnswer = text;
        idleTicks = 0;
        closedEmpty = false;
        patch({ answer: text });
        conversation.sendAnswerDelta(text, false);
        return;
      }

      // 文本没变。整轮都没有可读文本时 partial 一直是空的，不会触发上面那条：
      // 会话不再 running 就收尾，否则状态会永远停在 thinking。
      if (lastAnswer.length === 0) {
        if (!closedEmpty && !isSessionRunning(sessionId)) {
          closedEmpty = true;
          conversation.sendAnswerDelta("", true);
        }
        return;
      }

      // 兜底：流式中断时文本会停住不动，这时靠静止判定收尾。
      idleTicks += 1;
      if (idleTicks >= IDLE_TICKS_TO_END) {
        idleTicks = 0;
        conversation.sendAnswerDelta(lastAnswer, true);
        lastAnswer = "";
      }
    }, POLL_MS);

    return () => {
      window.clearInterval(timer);
      conversationRef.current = null;
      conversation.stop();
      void audioContext.close();
    };
  }, []);

  useEffect(() => {
    conversationRef.current?.setBlocked(options.isCompacting);
  }, [options.isCompacting]);

  return view;
}
