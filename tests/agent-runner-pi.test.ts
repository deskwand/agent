import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const agentRunnerPath = path.resolve(
  process.cwd(),
  "src/main/agent/agent-runner.ts",
);
const agentRunnerContent = readFileSync(agentRunnerPath, "utf8");

describe("AgentRunner pi-coding-agent integration", () => {
  it("avoids dynamic re-import shadowing for config store singletons", () => {
    // MCP 配置的组装已搬到内置 MCP 扩展（mcp-client-extension），agent-runner 不再直接读 store；
    // 但「不许动态重导入配置单例」这条约束与 MCP 无关，仍然成立。
    expect(agentRunnerContent).not.toContain(
      "const { configStore } = await import('../config/config-store')",
    );
    expect(agentRunnerContent).not.toContain(
      "const { mcpConfigStore } = await import('../mcp/mcp-config-store')",
    );
  });

  it("drives MCP through the builtin extension instead of building config itself", () => {
    // 接线：扩展工厂进了 extensionFactories
    expect(agentRunnerContent).toContain("createDeskwandMcpExtension()");
    expect(agentRunnerContent).toContain(
      'import { createDeskwandMcpExtension } from "../mcp/mcp-client-extension"',
    );
    // 旧的「自己组装 mcpServers 配置」路径已完全移除
    expect(agentRunnerContent).not.toContain("buildMcpCustomTools");
    expect(agentRunnerContent).not.toContain("Final mcpServers summary");
    // 投影的韧性（错误收集并跳过坏 server）由 mcp-config-projection.test.ts 覆盖
    expect(agentRunnerContent).toContain("function safeStringify");
  });

  it("uses standard markdown link guidance for sources citations", () => {
    expect(agentRunnerContent).toContain(
      "otherwise use standard Markdown links: [Title](https://deskwand.ai/chat/URL)",
    );
  });

  it("avoids duplicating the current user prompt in contextual history assembly", () => {
    expect(agentRunnerContent).toContain(
      "const conversationMessages = existingMessages",
    );
    // Image-containing messages are filtered out individually (not skipping entire history)
    expect(agentRunnerContent).toContain(
      "const textOnlyMessages = conversationMessages",
    );
    expect(agentRunnerContent).toContain("textOnlyMessages.slice(0, -1)");
    expect(agentRunnerContent).toContain(
      'textOnlyMessages[textOnlyMessages.length - 1]?.role === "user"',
    );
  });

  it("summarizes noisy SDK message updates instead of logging every text delta", () => {
    expect(agentRunnerContent).toContain(
      "const streamEventCounts = new Map<string, number>();",
    );
    expect(agentRunnerContent).toContain('updateType !== "text_delta" &&');
    expect(agentRunnerContent).toContain('updateType !== "thinking_delta" &&');
    expect(agentRunnerContent).toContain('"[AgentRunner] Event: message_end"');
    expect(agentRunnerContent).toContain(
      "messageUpdateCounts: getStreamEventSummary()",
    );
    expect(agentRunnerContent).toContain(
      'if (process.env.COWORK_LOG_SDK_MESSAGES_FULL === "1") {',
    );
    expect(agentRunnerContent).toContain(
      '"[AgentRunner] message_end raw message:"',
    );
  });

  it("reuses the shared user-facing error helper", () => {
    expect(agentRunnerContent).toContain('from "./agent-runner-message-end"');
    expect(agentRunnerContent).toContain("toUserFacingErrorText,");
    expect(agentRunnerContent).toContain(
      "const errorText = toUserFacingErrorText(toErrorText(error));",
    );
  });

  it("uses pi DefaultResourceLoader with additionalSkillPaths and appendSystemPrompt", () => {
    expect(agentRunnerContent).toContain("additionalSkillPaths: skillPaths");
    expect(agentRunnerContent).toContain("appendSystemPrompt,");
    expect(agentRunnerContent).not.toContain("systemPromptOverride");
  });

  it("recreates cached pi sessions when the runtime signature changes", () => {
    expect(agentRunnerContent).toContain(
      'import { buildPiSessionRuntimeSignature } from "./pi-session-runtime"',
    );
    expect(agentRunnerContent).toContain(
      "const sessionRuntimeSignature = buildPiSessionRuntimeSignature({",
    );
    expect(agentRunnerContent).toContain(
      "cachedSession.runtimeSignature !== sessionRuntimeSignature",
    );
    expect(agentRunnerContent).toContain(
      "Runtime changed, recreating cached pi session:",
    );
    expect(agentRunnerContent).toContain(
      "runtimeSignature: sessionRuntimeSignature",
    );
  });

  it("uses the normalized route protocol so openrouter follows the openai-compatible path", () => {
    // Route protocol normalization moved to pi-model-resolution.ts, which is
    // consumed by agent-sdk-one-shot.ts and agent-runner.ts.
    const modelResolutionPath = path.resolve(
      process.cwd(),
      "src/main/agent/pi-model-resolution.ts",
    );
    const modelResolutionContent = readFileSync(modelResolutionPath, "utf8");

    expect(modelResolutionContent).toContain(
      "export function resolvePiRouteProtocol(",
    );
    expect(modelResolutionContent).toContain(
      'if (provider === "openrouter") return "openai";',
    );
    expect(modelResolutionContent).toContain(
      "export function resolveSyntheticPiModelFallback(",
    );
  });

  it("nudges the model to proceed with reasonable assumptions", () => {
    expect(agentRunnerContent).toContain(
      "proceed immediately with reasonable assumptions",
    );
    expect(agentRunnerContent).toContain("within two days");
    expect(agentRunnerContent).toContain(
      "most recent two relevant publication days",
    );
  });

  it("routes tool results through structured helpers instead of stringifying base64 into text", () => {
    // MCP 工具结果不再经 agent-runner 的自研通道（由内置扩展处理），所以 MCP 专用的
    // normalizeMcpToolResultForModel 也随之不在这里使用；其余结构化归一化不变。
    expect(agentRunnerContent).toContain(
      'import { normalizeToolExecutionResultForUi } from "./tool-result-utils";',
    );
    expect(agentRunnerContent).toContain(
      "const normalizedToolResult = normalizeToolExecutionResultForUi(",
    );
    expect(agentRunnerContent).not.toContain(
      "else textParts.push(JSON.stringify(part));",
    );
    expect(agentRunnerContent).not.toContain(
      ": JSON.stringify(event.result || '');",
    );
  });

  it("does not reference removed AskUserQuestion or TodoWrite tools", () => {
    expect(agentRunnerContent).not.toContain("AskUserQuestion");
    expect(agentRunnerContent).not.toContain("TodoWrite");
    expect(agentRunnerContent).not.toContain("pendingQuestions");
  });

  it("chat-first behavioral rules are present", () => {
    expect(agentRunnerContent).toContain("CHAT FIRST");
    expect(agentRunnerContent).toContain(
      "Do NOT create, write, or edit files unless the user explicitly asks",
    );
    expect(agentRunnerContent).toContain("START DOING IT");
  });

  it("does not gate thinking display by thinkingLevel off in renderer events or final message blocks", () => {
    expect(agentRunnerContent).not.toContain(
      "shouldEmitThinking && parsed.thinking",
    );
    expect(agentRunnerContent).not.toContain("if (shouldEmitThinking) {");
    expect(agentRunnerContent).toContain("if (parsed.thinking) {");
    expect(agentRunnerContent).toContain("if (flushed.thinking) {");
    expect(agentRunnerContent).toContain(
      '} else if (block.type === "thinking") {',
    );
    expect(agentRunnerContent).toContain("contentBlocks.push({");
    expect(agentRunnerContent).toContain("thinking: block.thinking,");
  });
});
