import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Content split across MessageCard.tsx and the message/ sub-components directory
const messageCardPath = path.resolve(process.cwd(), "src/renderer/components/MessageCard.tsx");
const messageDir = path.resolve(process.cwd(), "src/renderer/components/message");
const messageCardContent = [
  fs.readFileSync(messageCardPath, "utf8"),
  ...fs.readdirSync(messageDir).map((f) => fs.readFileSync(path.join(messageDir, f), "utf8")),
].join("\n");
const chatViewContent = fs.readFileSync(
  path.resolve(process.cwd(), "src/renderer/components/ChatView.tsx"),
  "utf8",
);

describe("MessageCard fork button", () => {
  it("助手消息显示分叉按钮（GitBranch），用户消息不显示", () => {
    expect(messageCardContent).toContain("canFork && onForkMessage");
    expect(messageCardContent).toContain("GitBranch");
    expect(messageCardContent).toContain("messageCard.forkMessage");
    expect(messageCardContent).toContain("onForkMessage?: (message: Message) => void");
  });

  it("ChatView 传入 onForkMessage（防双击）", () => {
    expect(chatViewContent).toContain("onForkMessage={handleForkMessage}");
    expect(chatViewContent).toContain("forkSession(activeSession.id, message.id");
    expect(chatViewContent).toContain('t("chat.forkSuffix")');
  });
});
