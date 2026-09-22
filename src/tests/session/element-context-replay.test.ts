import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SettingsManager,
  SessionManager,
  ModelRuntime,
  convertToLlm,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { appendElementContext } from "../../main/agent/element-context-message";
import { entriesToMessages } from "../../main/session/entries-to-messages";

const XML =
  '<selected-element selector=".button">border-radius: 12px</selected-element>';

const selectedButtonRef = {
  pageUrl: "http://fixture/",
  tag: "button",
  classes: ["primary"],
  text: "开始使用",
  selector: "button.primary",
  selectorUnique: true,
  width: 132,
  height: 40,
};
let root: string;
let session: AgentSession | undefined;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "deskwand-element-context-"));
  const skillPath = join(root, "SKILL.md");
  writeFileSync(
    skillPath,
    "---\nname: picker-fixture\ndescription: Fixture skill\n---\nPICKER_SKILL_BODY\n",
  );
  const settings = SettingsManager.inMemory({ compaction: { enabled: false } });
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir: root,
    settingsManager: settings,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalSkillPaths: [skillPath],
  });
  await loader.reload();
  const runtime = await ModelRuntime.create({
    authPath: join(root, "auth.json"),
    modelsPath: null,
    modelsStorePath: join(root, "models-cache"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
  ({ session } = await createAgentSession({
    cwd: root,
    agentDir: root,
    modelRuntime: runtime,
    model: {
      id: "fixture",
      name: "Fixture",
      api: "openai-completions",
      provider: "fixture",
      baseUrl: "http://127.0.0.1:1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 4096,
      maxTokens: 256,
    },
    resourceLoader: loader,
    settingsManager: settings,
    sessionManager: SessionManager.create(root, join(root, "sessions")),
    noTools: "all",
  }));
});

afterEach(() => {
  session?.dispose();
  session = undefined;
  vi.restoreAllMocks();
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("element context SDK contract", () => {
  it("真实隐藏消息落盘，重开后 UI 无 XML、模型仍有快照", async () => {
    const sdk = session!;
    await appendElementContext(sdk, XML);
    const store = sdk.sessionManager;
    // 普通用户块按 SDK prompt() 的实际形状写入，不捏造 synthetic 标记。
    store.appendMessage({
      role: "user",
      content: [{ type: "text", text: "改圆角" }],
      timestamp: 1,
    });
    // SDK 首个 assistant message 到达时才 flush 新会话文件。
    store.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "收到" }],
      api: "openai-completions",
      provider: "fixture",
      model: "fixture",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 2,
    });
    const file = store.getSessionFile();
    if (!file) throw new Error("Expected a persisted session file");
    expect(readFileSync(file, "utf8")).toContain('"display":false');
    const reopened = SessionManager.open(file, join(root, "sessions"));
    const entries = reopened.getEntries();
    expect(
      entries.filter((entry) => entry.type === "custom_message"),
    ).toMatchObject([
      { customType: "browser_element_selection", content: XML, display: false },
    ]);
    const messages = entriesToMessages(entries, "s1");
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      sessionId: "s1",
      role: "user",
      content: [{ type: "text", text: "改圆角" }],
    });
    // 顺序：隐藏上下文必须排在用户那句话**之前**。
    // 顺序反了就是元素掉到指令后面，模型容易把那句话当成对上下文的补充说明。
    const customIndex = entries.findIndex((e) => e.type === "custom_message");
    const userIndex = entries.findIndex(
      (e) => e.type === "message" && e.message.role === "user",
    );
    expect(customIndex).toBeGreaterThanOrEqual(0);
    expect(customIndex).toBeLessThan(userIndex);
    expect(JSON.stringify(messages)).not.toContain("selected-element");
    expect(
      JSON.stringify(convertToLlm(reopened.buildSessionContext().messages)),
    ).toContain("selected-element");
  });

  it.each(["改圆角", "/skill:picker-fixture 改圆角"])(
    "元素上下文不改 SDK prompt 输入：%s",
    async (prompt) => {
      const sdk = session!;
      // 只替换最末端 agent 循环，SDK 的命令/技能展开和 custom message 路径仍真实执行。
      const run = vi.spyOn(sdk.agent, "prompt").mockResolvedValue(undefined);
      await appendElementContext(sdk, XML);
      await sdk.prompt(prompt);
      expect(run).toHaveBeenCalledOnce();
      const input = JSON.stringify(run.mock.calls[0][0]);
      expect(input).toContain("改圆角");
      expect(input).not.toContain("selected-element");
      if (prompt.startsWith("/skill:"))
        expect(input).toContain("PICKER_SKILL_BODY");
      expect(JSON.stringify(convertToLlm(sdk.agent.state.messages))).toContain(
        "selected-element",
      );
    },
  );

  it("重放时元素引用回到 user 消息上，且气泡里仍不含 XML", async () => {
    const sdk = session!;
    const selections = [selectedButtonRef];
    await appendElementContext(sdk, XML, selections);
    const store = sdk.sessionManager;
    store.appendMessage({
      role: "user",
      content: [{ type: "text", text: "改圆角" }],
      timestamp: 1,
    });
    store.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "收到" }],
      api: "openai-completions",
      provider: "fixture",
      model: "fixture",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 2,
    });
    const file = store.getSessionFile();
    if (!file) throw new Error("Expected a persisted session file");
    const reopened = SessionManager.open(file, join(root, "sessions"));
    const messages = entriesToMessages(reopened.getEntries(), "s1");
    expect(messages[0].elSelections).toEqual(selections);
    // 回显的是结构化 chip，不是 XML：既有不变量不许破
    expect(JSON.stringify(messages)).not.toContain("selected-element");
  });

  it("元素条目后面先出现 assistant，则引用不得骑到以后那条 user 消息上", async () => {
    const sdk = session!;
    const store = sdk.sessionManager;
    // 可达的悬挂形态：元素条目写下了，但**这一轮没有对应的 user 消息接手**
    // （例如回合中途 abort，或目标/自动消息插进来）。
    // 不可达的形态（streaming 时被推迟追加）不在此测——appendElementContext
    // 对 streaming 直接抛错，所以那种顺序产生不出来。
    await appendElementContext(sdk, XML, [selectedButtonRef]);
    store.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "自动消息" }],
      api: "openai-completions",
      provider: "fixture",
      model: "fixture",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 2,
    });
    store.appendMessage({
      role: "user",
      content: [{ type: "text", text: "下一轮" }],
      timestamp: 3,
    });
    const file = store.getSessionFile();
    if (!file) throw new Error("Expected a persisted session file");
    const reopened = SessionManager.open(file, join(root, "sessions"));
    const userMessages = entriesToMessages(reopened.getEntries(), "s1").filter(
      (m) => m.role === "user",
    );
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].elSelections).toBeUndefined();
  });

  it("多轮：每一轮的引用都回到各自那条 user 消息上", async () => {
    const sdk = session!;
    const store = sdk.sessionManager;
    const assistantMsg = (ts: number) => ({
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "收到" }],
      api: "openai-completions" as const,
      provider: "fixture",
      model: "fixture",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop" as const,
      timestamp: ts,
    });

    await appendElementContext(sdk, XML, [
      { ...selectedButtonRef, selector: "button.p1" },
    ]);
    store.appendMessage({
      role: "user",
      content: [{ type: "text", text: "第一句" }],
      timestamp: 1,
    });
    store.appendMessage(assistantMsg(2));
    await appendElementContext(sdk, XML, [
      { ...selectedButtonRef, selector: "button.p2" },
    ]);
    store.appendMessage({
      role: "user",
      content: [{ type: "text", text: "第二句" }],
      timestamp: 3,
    });
    store.appendMessage(assistantMsg(4));

    const file = store.getSessionFile();
    if (!file) throw new Error("Expected a persisted session file");
    const reopened = SessionManager.open(file, join(root, "sessions"));
    const userMessages = entriesToMessages(reopened.getEntries(), "s1").filter(
      (m) => m.role === "user",
    );
    expect(userMessages.map((m) => m.elSelections?.[0]?.selector)).toEqual([
      "button.p1",
      "button.p2",
    ]);
  });
});
