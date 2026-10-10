// src/renderer/utils/voice/voice-owner.ts
/**
 * @module renderer/utils/voice/voice-owner
 *
 * 「谁在用麦克风」的规则。状态在 store 的 `voiceInputOwner`，规则只在这里一份。
 *
 * 为什么需要它：`useVoiceInput` 是一个实例一条采集流，没有跨实例总线 —— 两个宿主
 * 同时按下就是两路 `getUserMedia` 抢同一支麦克风（既有注释：`ChatView.tsx` 按住
 * 说话那一行的开关）。主进程不拦这件事：`voice.start` 每次新建一条会话，`sessions`
 * 是 Map，两条可以并存。
 */

/** 底部聊天框的占用者 id。 */
export const CHAT_INPUT_VOICE_OWNER = "chat-input";

/** 一个 ask_user 字段的占用者 id 前缀（后面接 `<text|other>:<index>`）。 */
export function askUserVoiceOwnerPrefix(toolCallId: string): string {
  return `ask-user:${toolCallId}:`;
}

/** 是不是「别人在录」。自己占着不算，否则自己会被自己挡住。 */
export function isVoiceHeldElsewhere(
  owner: string | null,
  selfId: string,
): boolean {
  return owner !== null && owner !== selfId;
}

/** 本卡有没有字段在录（提交门用它，省一套各字段往上报状态的回调）。 */
export function isAskUserRecording(
  owner: string | null,
  toolCallId: string,
): boolean {
  return (
    owner !== null && owner.startsWith(askUserVoiceOwnerPrefix(toolCallId))
  );
}

/**
 * 按住说话此刻能不能监听 / 响应。
 *
 * 这里必须是「**别人**占着才算占」，不能用「占用者为空」当门：keydown 会先把自己
 * 变成占用者，`enabled` 跟着翻假，而 `usePushToTalk` 的 effect 会因为 deps 变化
 * 重订阅 —— 重订阅丢掉它内部的 `holding`，后面的 keyup 就匹配不上，录音再也停不下来。
 * 2026-10-10 评审实测到这个回归（按下不停、松手不停），所以单独立一个名字把它钉住。
 */
export function isPushToTalkAllowed(owner: string | null): boolean {
  return !isVoiceHeldElsewhere(owner, CHAT_INPUT_VOICE_OWNER);
}
