import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readChatView(): string {
  return readFileSync(
    path.resolve(process.cwd(), "src/renderer/components/ChatView.tsx"),
    "utf8",
  );
}

// ⚠️ 断言按 prettier 格式化之后的样子写：长 import 会被拆成多行，所以只断 `from`
// 与各标识符；长表达式同理，断它换行后的那半句。
describe("ChatView read receipt wiring", () => {
  it("derives the latest user message from the rendered window", () => {
    const source = readChatView();
    // 只断 import 来源 + 真实调用点：标识符列表会因为折行/不折行两种形状不同，
    // 而调用点无论如何都只有一种。
    expect(source).toContain('} from "../utils/message-read";');
    expect(source).toContain("const latestUserMessage = useMemo(");
    expect(source).toContain("findLatestUserMessage(displayedMessages)");
  });

  it("resolves the ring state once per render instead of once per message", () => {
    const source = readChatView();
    expect(source).toContain("const latestTurnReadState = useMemo(");
    expect(source).toContain("resolveReadState({");
    // 流式残段交给纯函数比对，不在这里预判
    expect(source).toContain("partialTurnId: activeTurn?.turnId ?? null");
    // 发送后到 session.status 回来之间那个 IPC 空档
    expect(source).toContain("isAwaiting: isSessionRunning || hasActiveTurn");
    // 分屏必须用 pane-scoped 选择器，不能用全局 activeSession 版
    expect(source).toContain("useSessionPartialThinking(activeSessionId)");
  });

  it("only hands the state to the newest user message", () => {
    const source = readChatView();
    expect(source).toContain("readState={");
    expect(source).toContain("message.id === latestUserMessage?.id");
    expect(source).toContain("? latestTurnReadState");
  });
});
