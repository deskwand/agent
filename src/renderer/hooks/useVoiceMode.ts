/**
 * @module renderer/hooks/useVoiceMode
 *
 * 把纯逻辑编排器接上真实依赖：麦克风、voice IPC、流式朗读，以及从 store
 * 读「本轮回复文本」。
 *
 * **回答归属**：提交问题时先分配一个 turnId，之后只读这个 turnId 的文字。
 * 取"partial 里最长的一条"在有排队轮时会念错 —— 旧回答还在生成，它更长。
 *
 * **本轮结束怎么判**（这里最容易写错）：不看"partial 被清空" —— 助手消息一落库
 * store 就清它，而工具调用之间会落好几条；也不看"文本静止 N 毫秒" —— 模型思考
 * 时会静很久。真正的结束信号是：目标轮不在 `activeTurn` / `pendingTurns`，且
 * 会话不再 `running`。宁可尾句晚读几句，也不要拿半句话当结束。
 */
import { useEffect, useRef, useState } from "react";
import type { VoiceErrorCode } from "../../shared/ipc-types";
import { DEFAULT_VOICE_MODE } from "../../shared/voice-mode";
import { useAppStore } from "../store";
import type { Message } from "../types";
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
  sessionId: string;
  isCompacting: boolean;
  /**
   * 把一轮问题发出去。由宿主注入 —— `continueSession` 是 useIPC 的返回值，
   * 不是 store action，放进 store 要多一层转发。
   *
   * `turnId` 由这里分配、宿主必须原样用：回答只按它归属。返回值表示宿主
   * **收没收下**这一轮（语音模式可能已经被关掉），不代表后台生成成功。
   */
  sendQuestion(text: string, turnId: string): boolean;
}

const EMPTY: VoiceModeView = {
  state: "calibrating",
  level: 0,
  transcript: "",
  answer: "",
  error: null,
};

const POLL_MS = 120;

/**
 * 指定轮次的回答全文 = 已落库的助手消息 + 还没落库的 partial。
 *
 * 顺序照 store：保存过的在前，正在生成的在后。partial 是当前这条未落库助手
 * 消息的正文，不是整轮正文 —— `addMessage` 会同步清掉对应 partial，所以同一份
 * 快照里不会两边都有同一段文字，不需要按内容去重。
 */
export function readVoiceAnswer(
  messages:
    | ReadonlyArray<Pick<Message, "role" | "turnId" | "content">>
    | undefined,
  partials: Record<string, { message: string; thinking: string }> | undefined,
  turnId: string | null,
): string {
  if (!turnId) return "";
  const saved = (messages ?? [])
    .filter(
      (message) => message.role === "assistant" && message.turnId === turnId,
    )
    .map((message) =>
      message.content
        .filter((block) => block.type === "text" && !block.synthetic)
        .map((block) => (block.type === "text" ? block.text : ""))
        .join(""),
    )
    .filter((text) => text.length > 0);
  const partial = partials?.[turnId]?.message ?? "";
  return [...saved, ...(partial ? [partial] : [])].join("\n");
}

export function useVoiceMode(options: UseVoiceModeOptions): VoiceModeView {
  const [view, setView] = useState<VoiceModeView>(EMPTY);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const conversationRef = useRef<VoiceConversation | null>(null);

  useEffect(() => {
    let live = true;
    const sessionId = options.sessionId;
    const patch = (next: Partial<VoiceModeView>) => {
      if (live) setView((prev) => ({ ...prev, ...next }));
    };

    // AudioContext 由这里创建并持有：`createStreamingSpeech` 的默认依赖每次都 new
    // 一个，而浮层每开一次就挂载一次 —— 不 close 就会一直漏。Chromium 对同时存在
    // 的 AudioContext 有上限，攒够了连 `new AudioContext` 都会抛。
    const audioContext = new AudioContext();
    const speech = createStreamingSpeech({
      speak: (text: string) => window.electronAPI.tts.speak(text),
      createQueue: () =>
        createAudioQueue({ createContext: () => audioContext }),
    });

    /** 本轮问题分配的轮次标识。只读它的文字，别的轮一概不看。 */
    let expectedTurnId: string | null = null;
    let lastAnswer = "";
    /** 收尾传过一次就不再传，避免每 120ms 重复 end 一次。 */
    let answerEnded = false;

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
      sendQuestion: (text) => {
        const store = useAppStore.getState();
        if (
          !live ||
          !store.voiceModeOpen ||
          store.voiceModeSessionId !== sessionId ||
          store.activeSessionId !== sessionId ||
          store.activeView !== "chat" ||
          !store.sessions.some((s) => s.id === sessionId && s.kind === "voice")
        )
          return false;
        // 先绑定再提交：宿主可能同步把这一轮写进 store。
        const turnId = crypto.randomUUID();
        expectedTurnId = turnId;
        const accepted = optionsRef.current.sendQuestion(text, turnId);
        if (!accepted) expectedTurnId = null;
        return accepted;
      },
      silenceMs:
        useAppStore.getState().appConfig?.voiceMode?.silenceMs ??
        DEFAULT_VOICE_MODE.silenceMs,
      onState: (state) => patch({ state }),
      onLevel: (level) => patch({ level }),
      onTranscript: (transcript) => patch({ transcript }),
      onQuestion: () => {
        // 新一轮被收下了：清掉上一轮的字幕与错误。绑定不动 ——
        // 它就是这个新轮的标识。
        patch({ transcript: "", answer: "", error: null });
        lastAnswer = "";
        answerEnded = false;
      },
      onSentence: () => {},
      onError: (error) => patch({ error }),
    });

    conversationRef.current = conversation;
    stopReadAloud(); // 浮层一开就停掉消息朗读：两路音频不共存
    void conversation.start();

    const timer = window.setInterval(() => {
      if (!live) return;
      // 还没提交过问题，或者这一轮已经收过尾：没有可做的。
      if (!expectedTurnId || answerEnded) return;

      const store = useAppStore.getState();
      const ss = store.sessionStates[sessionId];
      const text = readVoiceAnswer(
        ss?.messages,
        ss?.partialByTurn,
        expectedTurnId,
      );

      // 收尾判据：目标轮不挂在 activeTurn / pendingTurns 上，且会话不再 running。
      // 只满足"暂时没有文字"是不够的 —— 工具调用之间、排队等待期间都可能是这样。
      const targetActive = ss?.activeTurn?.turnId === expectedTurnId;
      const targetPending =
        ss?.pendingTurns.some((turn) => turn.turnId === expectedTurnId) ??
        false;
      const session = store.sessions.find((item) => item.id === sessionId);
      const ended =
        Boolean(session) &&
        session?.status !== "running" &&
        !targetActive &&
        !targetPending;

      if (text === lastAnswer && !ended) return;
      lastAnswer = text;
      patch({ answer: text });
      conversation.sendAnswerDelta(text, ended);
      if (ended) answerEnded = true;
    }, POLL_MS);

    return () => {
      live = false;
      window.clearInterval(timer);
      conversationRef.current = null;
      conversation.stop();
      void audioContext.close();
    };
  }, [options.sessionId]);

  useEffect(() => {
    conversationRef.current?.setBlocked(options.isCompacting);
  }, [options.isCompacting]);

  return view;
}
