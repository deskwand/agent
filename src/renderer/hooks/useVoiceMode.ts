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
 *
 * **音色模式只在渲染层读：`speak` 每句读一次 `voiceMode.fastVoice`**。快速传
 * `{ prefer: "matcha" }`；均衡不传 prefer，于是按文本路由到朗读的中文 / 英文音色。
 * 均衡那份模型与朗读共用：音质与音色只有一处配置（设置里的「语音」）。
 * 档位在这里读一次传下去；朗读那边不传，由主进程补齐（见 `withConfiguredTone`）。
 */
import { useEffect, useRef, useState } from "react";
import type { VoiceErrorCode } from "../../shared/ipc-types";
import { DEFAULT_VOICE_MODE, resolveVoiceTone } from "../../shared/voice-mode";
import { useAppStore } from "../store";
import type { Message } from "../types";
import { createAudioQueue } from "../utils/tts/audio-queue";
import { speakStream } from "../utils/tts/speak-stream";
import { startMicCapture } from "../utils/voice/mic-capture";
import { createVoiceSfx } from "../utils/voice/voice-sfx";
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
  /**
   * 正在念的那个合成单元（`speech.onSentence` 给的，**不是一句**，见
   * `voiceCaptionLine`）。念完留到下一轮开始。
   */
  spoken: string;
  error: VoiceErrorCode | null;
}

export interface UseVoiceModeOptions {
  sessionId: string;
  isCompacting: boolean;
  /** 用户把麦克风关了。只影响收音，不影响朗读。 */
  muted: boolean;
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
  spoken: "",
  error: null,
};

const POLL_MS = 120;

/** 退出音全长 620ms，留 80ms 余量。 */
const EXIT_CUE_TAIL_MS = 700;

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
      speak: (text, handlers) => {
        // **每次调用**读一次：换模式要能对下一句生效（`silenceMs` 不同，它只在
        // createVoiceConversation 时读一次就够，因为只影响状态机）。
        // 三档都在 `voiceMode.tone` 里（旧的 `fastVoice` 仍然读得到：
        // 没有 tone 的老配置按 fastVoice 归一化成 fast / balanced）
        const voiceMode = useAppStore.getState().appConfig?.voiceMode;
        const tone = resolveVoiceTone(voiceMode);
        return speakStream(text, { tone }, handlers);
      },
      createQueue: () =>
        createAudioQueue({ createContext: () => audioContext }),
    });

    // 进入音与退出音：复用同一个 AudioContext，不新建（Chromium 对同时存在的
    // AudioContext 有上限）。
    const sfx = createVoiceSfx({ createContext: () => audioContext });
    /** 进入音只在第一次听的时候响：回到 listening 的后续跳变都不响。 */
    let entryCuePlayed = false;
    /**
     * 采集失败过的会话不再报「我在听」。它之后可能因为解封回到 listening，
     * 但那时候没有麦克风 —— 状态机把采集失败也归进 blocked，所以这里挡住声音。
     */
    let captureFailed = false;

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
        // 不再要求「正在看这个会话」：后台运行就是为此。仍然只认这条会话 ——
        // 会话被删、运行时被换掉或结束，这一轮就作废。
        if (
          !live ||
          !store.voiceModeOpen ||
          store.voiceModeSessionId !== sessionId ||
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
      onState: (state) => {
        if (
          live &&
          state === "listening" &&
          !entryCuePlayed &&
          !captureFailed
        ) {
          entryCuePlayed = true;
          sfx.startCue();
        }
        patch({ state });
      },
      onLevel: (level) => patch({ level }),
      onTranscript: (transcript) => patch({ transcript }),
      onQuestion: () => {
        // 新一轮被收下了：清掉上一轮的字幕与错误。绑定不动 ——
        // 它就是这个新轮的标识。
        patch({ transcript: "", answer: "", spoken: "", error: null });
        lastAnswer = "";
        answerEnded = false;
      },
      // 一个合成单元开念：那一行跟着换。只认回传的文本，索引不用 ——
      // 打断后恢复时句子索引会从 0 重新排。
      onSentence: (_index, text) => patch({ spoken: text }),
      onError: (error) => {
        if (error === "VOICE_CAPTURE_FAILED") captureFailed = true;
        patch({ error });
      },
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
      // 退出音要响完：close() 延后到它的尾巴之后（设计文档 §6）。
      sfx.exitCue();
      window.setTimeout(() => void audioContext.close(), EXIT_CUE_TAIL_MS);
    };
  }, [options.sessionId]);

  useEffect(() => {
    conversationRef.current?.setBlocked(options.isCompacting);
  }, [options.isCompacting]);

  useEffect(() => {
    conversationRef.current?.setMuted(options.muted);
  }, [options.muted]);

  return view;
}
