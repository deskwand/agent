// src/renderer/hooks/useVoiceInput.ts
/**
 * @module renderer/hooks/useVoiceInput
 *
 * 语音输入的 UI 状态机与 IPC 编排。
 *
 * 拼接语义集中在这里：录音开始取一次草稿快照，之后每次 `partial`（全量文本）
 * 都写成「快照 + 文本」。输入框只负责读写，不认识语音这件事。
 *
 * 「整理」的范围也由这里界定：**本次语音产生的那段** = 当前文本去掉快照前缀。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceErrorCode, VoiceEvent } from "../../shared/ipc-types";
import {
  MicError,
  startMicCapture,
  type MicCapture,
} from "../utils/voice/mic-capture";

export type VoiceStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "finishing"
  | "polishing";

export interface UseVoiceInputOptions {
  /** 引擎已启用且已安装。false 时点按钮只提示，不碰麦克风。 */
  enabled: boolean;
  /**
   * 读当前草稿。**这是一个实时读取，不是快照**：录音开始时调一次取基线，
   * 整理结果回来时再调一次比对该不该写入（用户可能刚刚手改过）。
   */
  getSnapshot: () => string;
  /** 全量文本回调：参数是「快照 + 累积转写」。 */
  onText: (text: string) => void;
  /** 回滚到录音开始前的快照（取消 / 误触丢弃）。 */
  onRestore: (snapshot: string) => void;
  onBlocked: () => void;
  onError: (code: VoiceErrorCode) => void;
  /**
   * 整理真的失败了才调（不含“用户改过字所以丢弃结果”那种）。
   * 放在这里而不是适配层：`polish()` 返回的是个 boolean，四种情况都是 false，
   * 只有钩子内部分得清哪一种是真失败 —— 在外面统一报“整理失败”会误报。
   */
  onPolishFailed?: (reason: "failed" | "suspicious") => void;
}

export interface VoiceInputController {
  status: VoiceStatus;
  /** 0..1，给音量条。 */
  level: number;
  seconds: number;
  toggle: () => void;
  cancel: () => void;
  /** 整理本次语音产生的文本。返回是否成功。 */
  polish: () => Promise<boolean>;
  /** 还原成整理前的原文。 */
  revert: () => void;
  canPolish: boolean;
  canRevert: boolean;
}

export const VOICE_MESSAGE_KEYS: Record<VoiceErrorCode, string> = {
  VOICE_NOT_CONFIGURED: "chat.voiceEngineOff",
  VOICE_NOT_INSTALLED: "chat.voiceNotInstalled",
  VOICE_ENGINE_FAILED: "chat.voiceEngineFailed",
  VOICE_MIC_DENIED: "chat.voiceMicDenied",
  VOICE_MIC_UNAVAILABLE: "chat.voiceMicUnavailable",
  VOICE_CAPTURE_FAILED: "chat.voiceCaptureFailed",
  VOICE_INSTALL_FAILED: "chat.voiceInstallFailed",
};

export function useVoiceInput(
  options: UseVoiceInputOptions,
): VoiceInputController {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [voiceText, setVoiceText] = useState("");
  const [originalText, setOriginalText] = useState<string | null>(null);

  const sessionRef = useRef<string | null>(null);
  const captureRef = useRef<MicCapture | null>(null);
  const snapshotRef = useRef("");
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const teardown = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
    // 会话已结束，把 id 一并清掉：事件监听器拿它当归属判断，
    // 留着的话一条迟到的事件会把已经结束的那段文字重新写进输入框。
    sessionRef.current = null;
    setLevel(0);
    setSeconds(0);
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    const { enabled, onBlocked, onError, getSnapshot } = optionsRef.current;
    const api = window.electronAPI?.voice;
    if (!api) return;
    if (!enabled) {
      onBlocked();
      return;
    }

    sessionRef.current = null;
    setStatus("requesting");
    const snapshot = getSnapshot();

    let capture: MicCapture;
    try {
      capture = await startMicCapture((pcm, nextLevel) => {
        const sessionId = sessionRef.current;
        if (!sessionId) return;
        setLevel(nextLevel);
        const buffer = pcm.buffer.slice(
          pcm.byteOffset,
          pcm.byteOffset + pcm.byteLength,
        ) as ArrayBuffer;
        void api.pushAudio(sessionId, buffer);
      });
    } catch (error) {
      // startMicCapture 只会抛 MicError。能走到这里说明出了预料之外的事，
      // 以前它被报成「找不到可用的麦克风」—— 麦克风那时大概率是好的。
      console.error("[voice] unexpected capture error:", error);
      onError(error instanceof MicError ? error.code : "VOICE_CAPTURE_FAILED");
      setStatus("idle");
      return;
    }

    const started = await api.start();
    if (!started.ok) {
      capture.stop();
      onError(started.code);
      setStatus("idle");
      return;
    }

    snapshotRef.current = snapshot;
    sessionRef.current = started.sessionId;
    captureRef.current = capture;
    setVoiceText("");
    setOriginalText(null);
    setSeconds(0);
    setStatus("recording");
  }, []);

  const stop = useCallback(async () => {
    const sessionId = sessionRef.current;
    const api = window.electronAPI?.voice;
    if (!sessionId || !api) return;
    setStatus("finishing");
    captureRef.current?.stop();
    captureRef.current = null;
    await api.stop(sessionId);
  }, []);

  const cancel = useCallback(async () => {
    const sessionId = sessionRef.current;
    window.electronAPI?.voice.cancel(sessionId ?? "");
    sessionRef.current = null;
    optionsRef.current.onRestore(snapshotRef.current);
    setVoiceText("");
    teardown();
  }, [teardown]);

  const toggle = useCallback(() => {
    if (status === "idle") void start();
    else if (status === "recording") void stop();
  }, [status, start, stop]);

  // 事件订阅：只在挂载时建一次。
  useEffect(() => {
    const unsubscribe = window.electronAPI?.voice.onEvent(
      (event: VoiceEvent) => {
        if (event.type === "install") return;
        if (event.sessionId !== sessionRef.current) return;

        if (event.type === "partial") {
          setVoiceText(event.text);
          optionsRef.current.onText(snapshotRef.current + event.text);
          return;
        }
        if (event.type === "done") {
          if (event.discarded) {
            optionsRef.current.onRestore(snapshotRef.current);
            setVoiceText("");
          } else {
            setVoiceText(event.text);
            optionsRef.current.onText(snapshotRef.current + event.text);
          }
          teardown();
          return;
        }
        optionsRef.current.onError(event.code);
        setVoiceText("");
        teardown();
      },
    );
    return unsubscribe;
  }, [teardown]);

  // 录音计时（只为了显示秒数）
  useEffect(() => {
    if (status !== "recording") return;
    const timer = window.setInterval(
      () => setSeconds((prev) => prev + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [status]);

  // Esc 取消。录音期间输入框只读，所以不会有「Esc 想关别的」的冲突。
  useEffect(() => {
    if (status !== "recording" && status !== "requesting") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void cancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [status, cancel]);

  const polish = useCallback(async () => {
    const api = window.electronAPI?.voice;
    if (!api || !voiceText.trim() || status !== "idle") return false;

    const sent = voiceText;
    setStatus("polishing");
    try {
      // sessionId 传 null：这里手上只有**语音会话**的 id，而 recordAuxUsage 要的是
      // **聊天会话** id。两者混用会往用量表里写一个指不到任何会话的悬空引用，
      // 比诚实的不归属更糟。
      const result = await api.polish(sent, null);
      if (!result.ok || !result.text) {
        // 对调用方只分两种：「结果可疑」与「其他失败」。"empty" 归到后者。
        optionsRef.current.onPolishFailed?.(
          result.reason === "suspicious" ? "suspicious" : "failed",
        );
        return false;
      }
      // 整理期间输入框**不是只读**的，用户可能已经在改字了。
      // 那就丢掉结果，别把他的修改盖回去。
      // （比「整理期间锁死输入框」好：1~3 秒的等待里不让改字很碍事）
      //
      // 比的是**实时草稿**，不是 voiceText：用户手改走的是输入框自己的路径，
      // 根本不经过 voice.event，所以只盯状态永远发现不了。
      if (optionsRef.current.getSnapshot() !== snapshotRef.current + sent) {
        return false;
      }
      setOriginalText(sent);
      setVoiceText(result.text);
      optionsRef.current.onText(snapshotRef.current + result.text);
      return true;
    } finally {
      setStatus("idle");
    }
  }, [voiceText, status]);

  const revert = useCallback(() => {
    if (originalText === null) return;
    setVoiceText(originalText);
    optionsRef.current.onText(snapshotRef.current + originalText);
    setOriginalText(null);
  }, [originalText]);

  return {
    status,
    level,
    seconds,
    toggle,
    cancel,
    polish,
    revert,
    canPolish:
      status === "idle" && voiceText.trim().length > 0 && originalText === null,
    canRevert: originalText !== null,
  };
}
