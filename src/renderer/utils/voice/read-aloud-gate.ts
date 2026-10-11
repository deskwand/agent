/**
 * @module renderer/utils/voice/read-aloud-gate
 *
 * 「装好语音之后自动开始朗读」的四条护栏。下载可能几分钟，期间用户可能已经
 * 走开、开了语音模式、或开始读别的消息 —— 那时自动出声就是意外。
 *
 * 不满足时降级成「再点一次朗读」（`messageCard.readAloudReadyAgain`），
 * 不自动出声。
 */
export interface AutoStartConditions {
  /** 那条消息还在 DOM 里。 */
  messageMounted: boolean;
  /** 还是用户当初点的那条（没被"读 B"顶掉）。 */
  messageStillCurrent: boolean;
  /** 语音运行时没打开：两路声音不能同时响。 */
  voiceRuntimeOpen: boolean;
  /** 期间没人开始过别的朗读。 */
  noReadStartedSince: boolean;
}

export function shouldAutoStartReadAloud(
  conditions: AutoStartConditions,
): boolean {
  return (
    conditions.messageMounted &&
    conditions.messageStillCurrent &&
    !conditions.voiceRuntimeOpen &&
    conditions.noReadStartedSince
  );
}

/**
 * 「最新一次朗读意图」的令牌。**模块级**，不是每张卡片一个 ref ——
 * 后者挡不住跨卡片的情形：点 A 的朗读（弹确认）→ 再点 B 的朗读（弹确认）→
 * 装好后两个卡片各自的 ref 都"还是自己"，A 的回调会先跑。
 */
let latestReadIntent = 0;

export function nextReadIntent(): number {
  return ++latestReadIntent;
}

export function isLatestReadIntent(token: number): boolean {
  return token === latestReadIntent;
}
