/**
 * @module renderer/utils/voice/voice-mode-gate
 *
 * 「开始语音模式」的共同前置。两个宿主都走它：
 *  - rail 那颗按钮（`App.tsx` 的 `handleCreateVoiceSession`）—— 先建会话再开浮层
 *  - 语音会话空态那颗「开始语音 / 继续语音」（`ChatView.tsx`）—— 直接开已有会话
 *
 * 它管两件事，顺序不能反：
 *
 * 1. **别人在录音就不抢麦**。语音模式会开麦，而全应用只允许一个麦克风占用者
 *    （`utils/voice/voice-owner.ts`）。这两条路今天都没有前置检查 —— 别人在录时
 *    点它们就是第二路 `getUserMedia`。先看占用者，且**这一下什么都不做**
 *    （不抢麦：用户正在说的话不能丢）。
 * 2. **缺 ASR 就不进去**。今天这条路进去之后才被 `voice.start` 拒掉，错误只能
 *    落在浮层字幕上。
 *
 * 抽成纯函数是为了能在没有 React 的情况下钉住这两条。
 */
import type { EnsureOutcome } from "../../capabilities/capability-gate";

export type VoiceModeStartResult =
  | { status: "ok" }
  | {
      status: "blocked";
      reason: "mic-busy" | "capability";
      /**
       * 能力门那一次的结果。**宿主靠它决定要不要给"装好再点一次"的提示**：
       * `cancelled` = 确认弹窗已经摆出来了，装完之后要告诉用户回来再点；
       * busy / failed / unsupported 则不该再催（spec §2.5）。
       */
      outcome?: EnsureOutcome;
    };

export async function ensureVoiceModeStart(deps: {
  ensureReady: () => Promise<EnsureOutcome>;
  /** store 的 `voiceInputOwner !== null`。读的是**当下**的值，不是渲染时的快照。 */
  micBusy: () => boolean;
}): Promise<VoiceModeStartResult> {
  if (deps.micBusy()) return { status: "blocked", reason: "mic-busy" };
  const outcome = await deps.ensureReady();
  if (outcome !== "ready")
    return { status: "blocked", reason: "capability", outcome };
  return { status: "ok" };
}
