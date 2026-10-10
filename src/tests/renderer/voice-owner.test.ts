import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHAT_INPUT_VOICE_OWNER,
  askUserVoiceOwnerPrefix,
  isAskUserRecording,
  isPushToTalkAllowed,
  isVoiceHeldElsewhere,
} from "../../renderer/utils/voice/voice-owner";

const chatViewSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "../../renderer/components/ChatView.tsx"),
  "utf8",
);

describe("占用者规则", () => {
  it("「别人在录」对自己为假", () => {
    expect(isVoiceHeldElsewhere(null, CHAT_INPUT_VOICE_OWNER)).toBe(false);
    expect(
      isVoiceHeldElsewhere(CHAT_INPUT_VOICE_OWNER, CHAT_INPUT_VOICE_OWNER),
    ).toBe(false);
    expect(
      isVoiceHeldElsewhere("ask-user:t-1:text:0", CHAT_INPUT_VOICE_OWNER),
    ).toBe(true);
    expect(
      isVoiceHeldElsewhere("ask-user:t-1:text:0", "ask-user:t-1:text:0"),
    ).toBe(false);
  });

  it("本卡有没有字段在录：认前缀，不认别卡", () => {
    expect(askUserVoiceOwnerPrefix("t-1")).toBe("ask-user:t-1:");
    expect(isAskUserRecording("ask-user:t-1:text:0", "t-1")).toBe(true);
    expect(isAskUserRecording("ask-user:t-1:other:2", "t-1")).toBe(true);
    expect(isAskUserRecording("ask-user:t-2:text:0", "t-1")).toBe(false);
    expect(isAskUserRecording(CHAT_INPUT_VOICE_OWNER, "t-1")).toBe(false);
    expect(isAskUserRecording(null, "t-1")).toBe(false);
  });

  it("按住说话只被「别处」挡住：自己占着时仍要能松手停", () => {
    expect(isPushToTalkAllowed(null)).toBe(true);
    expect(isPushToTalkAllowed(CHAT_INPUT_VOICE_OWNER)).toBe(true);
    expect(isPushToTalkAllowed("ask-user:t-1:text:0")).toBe(false);
  });
});

/**
 * ChatView 没有运行时级用例（900+ 行的组件要挂一整套 IPC 替身），仓库既有做法是
 * 源码守卫（同 `chat-input-status.test.ts:369-372`）。这三处正是「卡片在录时聊天框
 * 必须让路」的全部接线，删掉任何一处都是静默回归。
 *
 * 比对前把换行/缩进压成单空格：ChatView 缩进很深，prettier 会把长调用拆成多行。
 */
const flatChatView = chatViewSource.replace(/\s+/g, " ");

describe("ChatView 的接线", () => {
  it("占用、按住说话让路、聊天框麦克风让路三处都在", () => {
    expect(flatChatView).toContain(
      "setVoiceInputOwner(CHAT_INPUT_VOICE_OWNER)",
    );
    expect(flatChatView).toContain("isPushToTalkAllowed(voiceInputOwner)");
    expect(flatChatView).toContain("isVoiceHeldElsewhere(");
    expect(flatChatView).toContain("voiceInputOwner, CHAT_INPUT_VOICE_OWNER");
  });
});
