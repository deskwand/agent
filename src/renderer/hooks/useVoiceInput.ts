// src/renderer/hooks/useVoiceInput.ts
/**
 * @module renderer/hooks/useVoiceInput
 *
 * 语音输入的 UI 状态机与 IPC 编排。
 *
 * 拼接语义集中在这里：录音开始取一次草稿快照，之后每次 `partial`（全量文本）
 * 都写成「快照 + 文本」。输入框只负责读写，不认识语音这件事。
 *
 * 自动整理的作用范围也由这里界定：**连续几次语音写进框里的那段文字**。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceErrorCode, VoiceEvent } from "../../shared/ipc-types";
import {
  MicError,
  startMicCapture,
  type MicCapture,
} from "../utils/voice/mic-capture";

export type VoiceStatus = "idle" | "requesting" | "recording" | "finishing";

export interface UseVoiceInputOptions {
  /**
   * 开始录音前的就绪检查。返回 false = 这次不录。
   *
   * 这一句会 **await**：宿主可能在写配置、起下载、甚至弹一个确认等用户回答。
   * 放在钩子外面是因为只有宿主知道「刚写完配置」这件事 —— 钩子手里的 enabled
   * 是渲染时的快照，写配置的回调回来时它可能还是旧的，会把自己挡回去。
   */
  ensureReady: () => Promise<boolean>;
  /**
   * 自动整理（配置 `voiceEngine.autoPolish`，默认开）。
   * 关掉 = 完全不整理 —— 手动入口已经删了，这是唯一的闸。
   */
  autoPolish: boolean;
  /**
   * 读当前草稿。**这是一个实时读取，不是快照**：录音开始时调一次取基线，
   * 整理结果回来时再调一次比对该不该写入（用户可能刚刚手改过）。
   */
  getSnapshot: () => string;
  /** 全量文本回调：参数是「快照 + 累积转写」。 */
  onText: (text: string) => void;
  /** 回滚到录音开始前的快照（取消 / 误触丢弃）。 */
  onRestore: (snapshot: string) => void;
  onError: (code: VoiceErrorCode) => void;
}

export interface VoiceInputController {
  status: VoiceStatus;
  /** 0..1，给音量条。 */
  level: number;
  seconds: number;
  toggle: () => void;
  cancel: () => void;
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

/**
 * 会话建好之前最多缓存多少音频。4 秒 = 冷启动实测约 2.2~2.4s 留一倍余量
 * （早期版本按当时估的「~700ms」定了 2 秒，首次按下会把尾巴截掉）。
 * 再多就是在为一个不该持续那么久的状态占内存。
 */
const MAX_PENDING_BYTES = 16000 * 2 * 4;

/**
 * 收尾之后等这么久才发起整理。
 *
 * 短于它视为「同一次思路里的两段」，合并成一次调用；长于它才单独整理。
 * 900 是待调的经验值，不是测出来的：太短会退化成每一段调一次模型，太长会让
 * 整理明显迟到。所以它是个常量，不做成配置项。
 */
export const POLISH_DEBOUNCE_MS = 900;

export function useVoiceInput(
  options: UseVoiceInputOptions,
): VoiceInputController {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);

  const sessionRef = useRef<string | null>(null);
  const captureRef = useRef<MicCapture | null>(null);
  const snapshotRef = useRef("");
  /**
   * 每次 `start()` 取一次当前值，`cancel()` 递增它来作废「还在半路上」的那次 start()。
   *
   * 没有它的话，`requesting` 期间按 Esc 会两头落空：cancel() 手里 `sessionRef` 与
   * `captureRef` 都还是 null（两者要等 await 回来才赋值），所以它只能什么都不做；
   * 而那次 start() 接着跑完，把会话装好 —— 录音自己复活，文字继续往输入框里写。
   */
  const attemptRef = useRef(0);
  /** 会话建好之前采到的帧，按序保存。上限见 MAX_PENDING_BYTES。 */
  const pendingRef = useRef<{ frames: ArrayBuffer[]; bytes: number }>({
    frames: [],
    bytes: 0,
  });
  const clearPending = useCallback(() => {
    pendingRef.current = { frames: [], bytes: 0 };
  }, []);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // ── 自动整理 ────────────────────────────────────────────────────
  /**
   * 连续段：`base` 是这段语音之前草稿里的前缀，`text` 是本段累积的原始转写。
   * 不变式 `base + text === 草稿`（逐字）成立，这段才可整理。
   */
  const runRef = useRef({ base: "", text: "" });
  const polishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 在飞任务记的是「发出去的那段文本」，用来判断结果过期没有。 */
  const polishInFlightRef = useRef<string | null>(null);
  /**
   * 事件订阅 effect 只建一次，它的闭包里读不到新的 status，只能镜像一份
   * （与上面 `optionsRef.current = options` 同款做法）。
   */
  const statusRef = useRef<VoiceStatus>("idle");
  statusRef.current = status;

  const clearPolishTimer = useCallback(() => {
    if (polishTimerRef.current === null) return;
    clearTimeout(polishTimerRef.current);
    polishTimerRef.current = null;
  }, []);

  /**
   * 「能不能发这次整理 / 能不能把结果写进去」。
   *
   * 三件事其实是一件事：开关开着、现在没有录音在写这个框（录音收尾写的是它开始时
   * 的快照，比整理稿旧的字更旧）、草稿逐字没变（用户打字 / 发送 / 清空都算他接管了文字）。
   * 发起前与落地前各判一次，两处用同一个谓词，条件只维护这一份。
   */
  const canApply = useCallback((base: string, text: string): boolean => {
    return (
      optionsRef.current.autoPolish &&
      statusRef.current === "idle" &&
      optionsRef.current.getSnapshot() === base + text
    );
  }, []);

  /**
   * 跑一次整理：作用范围就是当前连续段。
   *
   * 结果落地与否只看 `canApply`。这段已经死了（用户改了字 / 发送了 / 正在录音）
   * 就静默放弃；这段还活着但长出了新内容（又说了新的一段）就按合并后的文本补跑一次。
   */
  const runPolish = useCallback(async (): Promise<void> => {
    const api = window.electronAPI?.voice;
    if (!api) return;
    if (polishInFlightRef.current !== null) return;

    const run = runRef.current;
    const source = run.text;
    if (!source.trim()) return;
    if (!canApply(run.base, source)) return;

    polishInFlightRef.current = source;
    // sessionId 传 null：这里手上只有语音会话 id，而 recordAuxUsage 要的是聊天会话 id。
    // handler 抛错会让 invoke 直接 reject（同 voice.start 那条），所以接住并记日志，
    // 不能让一个未处理的 rejection 冒到全局。
    const result = await api.polish(source, null).catch((error: unknown) => {
      console.error("[voice] polish rejected:", error);
      return null;
    });
    polishInFlightRef.current = null;

    if (result?.ok && result.text && canApply(run.base, source)) {
      optionsRef.current.onText(run.base + result.text);
      return;
    }

    // 没落地。这段又长出新内容了就补跑一次（canApply 会在里面再判一次）；
    // 否则是用户改了字 / 发送了 / 正在录音，什么都不做。
    if (runRef.current.text !== source) void runPolish();
  }, [canApply]);

  /** 收尾之后（重）起防抖：连说多段合并成一次调用。 */
  const schedulePolish = useCallback(() => {
    clearPolishTimer();
    polishTimerRef.current = setTimeout(() => {
      polishTimerRef.current = null;
      void runPolish();
    }, POLISH_DEBOUNCE_MS);
  }, [clearPolishTimer, runPolish]);

  /**
   * 把「到点了却被录音挡回去」的那次整理补回来。
   *
   * 计时器到点时若正有一次录音在写这个框，这次发起必然白花（见 `canApply` 的
   * status 条），于是计时器被消费掉。而那次录音结束时**不一定**会重起计时器：
   * 它可能一个字都没吐（Esc 取消 / 误触丢弃 / 空结果 / 引擎报错）—— 已经写进框里的
   * 那段转写就永远等不到整理。四种收尾都汇到 `teardown()`，所以在那里补一次。
   *
   * 不会死循环：真的落地了就不变式破了，下一次 `canApply` 自然为假；用户改了字同理。
   */
  const reschedulePolishIfDue = useCallback(() => {
    if (polishTimerRef.current !== null) return;
    if (polishInFlightRef.current !== null) return;
    const run = runRef.current;
    if (!run.text.trim()) return;
    if (!canApply(run.base, run.text)) return;
    schedulePolish();
  }, [canApply, schedulePolish]);

  const teardown = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
    // 会话已结束，把 id 一并清掉：事件监听器拿它当归属判断，
    // 留着的话一条迟到的事件会把已经结束的那段文字重新写进输入框。
    sessionRef.current = null;
    clearPending();
    setLevel(0);
    setSeconds(0);
    setStatus("idle");
  }, [clearPending]);

  const start = useCallback(async () => {
    const { ensureReady, onError, getSnapshot } = optionsRef.current;
    const api = window.electronAPI?.voice;
    if (!api) return;

    // 先占住 requesting，再等就绪门。
    //
    // 顺序不能反：`ensureReady` 要 await（一次 IPC；开引擎时还要落一次配置），
    // 而 `toggle()` 只拿 status 当互斥。等待期间若还停在 idle，同一颗按钮会被
    // 再点一次 —— 两条采集流（两个 getUserMedia）、两个会话，而第一条采集没任何
    // 人停它（系统录音灯会一直亮），它的帧还会被写进后建的那个会话。
    sessionRef.current = null;
    clearPending();
    setStatus("requesting");
    const attempt = attemptRef.current;

    // 就绪门：没启用、没装模型都在这一句里收口（写配置 / 起下载 / 弹确认）。
    if (!(await ensureReady())) {
      setStatus("idle");
      return;
    }
    // 等待期间被取消（Esc）：别再把采集拉起来。
    if (attempt !== attemptRef.current) return;

    const snapshot = getSnapshot();

    let capture: MicCapture;
    try {
      capture = await startMicCapture((pcm, nextLevel) => {
        // 音量条立即响应：按下就该有反馈，不该等会话建好
        setLevel(nextLevel);
        const buffer = pcm.buffer.slice(
          pcm.byteOffset,
          pcm.byteOffset + pcm.byteLength,
        ) as ArrayBuffer;
        const sessionId = sessionRef.current;
        if (!sessionId) {
          // 会话还没建好（首次要加载 162MB 模型，实测 2.2~2.4s；首次还要过权限弹窗）。
          // 先存着，建好后冲进去 —— 本地方案不要那 200ms 门槛就是为了不切字，
          // 把这段丢掉等于把当初否掉的东西又加了回来。
          const pending = pendingRef.current;
          if (pending.bytes + buffer.byteLength <= MAX_PENDING_BYTES) {
            pending.frames.push(buffer);
            pending.bytes += buffer.byteLength;
          }
          return;
        }
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

    // 取消发生在「拿麦克风」的过程中：会话压根别建。
    if (attempt !== attemptRef.current) {
      capture.stop();
      return;
    }

    // handler 抛错会让 invoke 直接 reject。不接住的话状态会卡在 "requesting"，
    // 而 requesting 下麦克风按钮是禁用的 —— 用户只能重开窗口。
    // 转成同形状的失败结果，后面的清理路径就能照常跑（含 capture.stop()）。
    const started = await api.start().catch((error: unknown) => {
      console.error("[voice] voice.start rejected:", error);
      return { ok: false as const, code: "VOICE_ENGINE_FAILED" as const };
    });
    if (!started.ok) {
      capture.stop();
      clearPending();
      onError(started.code);
      setStatus("idle");
      return;
    }

    // 取消发生在「建会话」的过程中：把刚建好的会话收掉，别让它复活成一次录音。
    if (attempt !== attemptRef.current) {
      void api.cancel(started.sessionId);
      capture.stop();
      return;
    }

    snapshotRef.current = snapshot;
    sessionRef.current = started.sessionId;
    // 把会话建好之前采到的帧按序冲进去。顺序不能乱：识别器拿到的流必须是时间序。
    const pending = pendingRef.current;
    for (const frame of pending.frames) {
      void api.pushAudio(started.sessionId, frame);
    }
    clearPending();
    captureRef.current = capture;
    setSeconds(0);
    setStatus("recording");
  }, [clearPending]);

  const stop = useCallback(async () => {
    const sessionId = sessionRef.current;
    const api = window.electronAPI?.voice;
    if (!sessionId || !api) return;
    setStatus("finishing");
    captureRef.current?.stop();
    captureRef.current = null;
    // 收尾失败不能把状态留在 finishing —— 那个态下麦克风按钮是禁用的，
    // 用户除了重开窗口没别的出路。与上面 `voice.start` 被拒同一类问题。
    try {
      await api.stop(sessionId);
    } catch (error) {
      console.error("[voice] voice.stop rejected:", error);
      optionsRef.current.onError("VOICE_ENGINE_FAILED");
      teardown();
    }
  }, [teardown]);

  const cancel = useCallback(async () => {
    // 作废还在半路上的 start()，否则它会把这次取消掉的录音装回来。
    attemptRef.current += 1;
    const hadSession = sessionRef.current !== null;
    window.electronAPI?.voice.cancel(sessionRef.current ?? "");
    sessionRef.current = null;
    // 只有真的开始过才回滚：requesting 期间被取消时，输入框里是用户自己的草稿，
    // 而快照还是初始的空串 —— 回滚等于替他清空。
    if (hadSession) optionsRef.current.onRestore(snapshotRef.current);
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
        // VAD 事件不带 sessionId（它属于语音模式，不属于任何一条录音）。
        if (event.type === "vad") return;
        if (event.sessionId !== sessionRef.current) return;

        if (event.type === "partial") {
          optionsRef.current.onText(snapshotRef.current + event.text);
          return;
        }
        if (event.type === "done") {
          if (event.discarded) {
            optionsRef.current.onRestore(snapshotRef.current);
          } else {
            optionsRef.current.onText(snapshotRef.current + event.text);
            // 连续段记账：这次录音的起点仍等于本段起点（中间没人打字）就往后接，
            // 否则以这次录音的起点重新开一段。两个分支都满足 base + text === 草稿。
            const run = runRef.current;
            runRef.current =
              snapshotRef.current === run.base + run.text
                ? { base: run.base, text: run.text + event.text }
                : { base: snapshotRef.current, text: event.text };
            if (event.text.trim()) schedulePolish();
          }
          teardown();
          return;
        }
        optionsRef.current.onError(event.code);
        teardown();
      },
    );
    return unsubscribe;
  }, [teardown, schedulePolish]);

  // 卸载时清掉待跑的计时器。在飞的任务不用管：能不能落地只看实时草稿，
  // 而宿主卸载后输入框 ref 已是 null，写入自然落成空操作。
  useEffect(() => clearPolishTimer, [clearPolishTimer]);

  // 每次回到 idle 都看一眼：到点被录音挡下的那次整理还在不在等。
  //
  // 挂在状态上而不挂在 `teardown()` 里：回到 idle 的路径不止一条（收尾、Esc 取消、
  // 误触丢弃、引擎报错、voice.start 被拒、就绪检查没过），而这些路径里只有一部分
  // 会吐出新文字、只有那部分会重起计时器。漏一条，那段已经写进框里的转写就永远
  // 得不到整理（手动按钮和失败提示都已经删了，用户看不出少了什么）。
  useEffect(() => {
    if (status === "idle") reschedulePolishIfDue();
  }, [status, reschedulePolishIfDue]);

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

  return {
    status,
    level,
    seconds,
    toggle,
    cancel,
  };
}
