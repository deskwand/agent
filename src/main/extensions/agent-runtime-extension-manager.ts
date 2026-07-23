import type {
  AgentRuntimeCustomTool,
  AgentRuntimeExtension,
  AfterSessionRunContext,
  AfterSessionRunResult,
  BeforeSessionRunContext,
  BeforeSessionRunResult,
  CommandContext,
  CommandResult,
  SessionDeletedContext,
} from "./agent-runtime-extension";
import { logError, logWarn } from "../utils/logger";

function mergeCustomTools(
  tools: AgentRuntimeCustomTool[],
): AgentRuntimeCustomTool[] {
  const merged = new Map<string, AgentRuntimeCustomTool>();
  for (const tool of tools) {
    if (!tool?.name) {
      continue;
    }
    if (merged.has(tool.name)) {
      logWarn(
        `[AgentRuntimeExtensionManager] Duplicate custom tool overridden: ${tool.name}`,
      );
    }
    merged.set(tool.name, tool);
  }
  return Array.from(merged.values());
}

export class AgentRuntimeExtensionManager {
  private readonly extensions: AgentRuntimeExtension[];

  constructor(extensions: AgentRuntimeExtension[] = []) {
    this.extensions = [...extensions];
  }

  register(extension: AgentRuntimeExtension): void {
    this.extensions.push(extension);
  }

  getExtension<T extends AgentRuntimeExtension>(name: string): T | undefined {
    return this.extensions.find((e) => e.name === name) as T | undefined;
  }

  async beforeSessionRun(
    context: BeforeSessionRunContext,
  ): Promise<BeforeSessionRunResult> {
    const promptPrefixes: string[] = [];
    const systemPromptSuffixes: string[] = [];
    const customTools: AgentRuntimeCustomTool[] = [];

    for (const extension of this.extensions) {
      if (!extension.beforeSessionRun) {
        continue;
      }
      try {
        const result = await extension.beforeSessionRun(context);
        if (!result) {
          continue;
        }
        if (result.promptPrefix?.trim()) {
          promptPrefixes.push(result.promptPrefix.trim());
        }
        if (result.systemPromptSuffix?.trim()) {
          systemPromptSuffixes.push(result.systemPromptSuffix.trim());
        }
        if (result.customTools?.length) {
          customTools.push(...result.customTools);
        }
      } catch (error) {
        logError(
          `[AgentRuntimeExtensionManager] beforeSessionRun failed for ${extension.name}:`,
          error,
        );
      }
    }

    return {
      promptPrefix: promptPrefixes.join("\n\n").trim() || undefined,
      systemPromptSuffix: systemPromptSuffixes.join("\n\n").trim() || undefined,
      customTools: mergeCustomTools(customTools),
    };
  }

  async afterSessionRun(
    context: AfterSessionRunContext,
  ): Promise<AfterSessionRunResult> {
    const result: AfterSessionRunResult = {};
    const outcomes = await Promise.allSettled(
      this.extensions.map(async (extension) => {
        if (!extension.afterSessionRun) {
          return;
        }
        try {
          return await extension.afterSessionRun(context);
        } catch (error) {
          logError(
            `[AgentRuntimeExtensionManager] afterSessionRun failed for ${extension.name}:`,
            error,
          );
        }
      }),
    );
    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled" && outcome.value) {
        if (!result.continuePrompt && outcome.value.continuePrompt) {
          result.continuePrompt = outcome.value.continuePrompt;
        }
        if (!result.goalStatus && outcome.value.goalStatus) {
          result.goalStatus = outcome.value.goalStatus;
        }
        if (!result.summaryMessage && outcome.value.summaryMessage) {
          result.summaryMessage = outcome.value.summaryMessage;
        }
      }
    }
    return result;
  }

  async handleCommand(context: CommandContext): Promise<CommandResult | null> {
    for (const extension of this.extensions) {
      if (!extension.onCommand) {
        continue;
      }
      try {
        const result = await extension.onCommand(context);
        if (result?.handled) {
          return result;
        }
      } catch (error) {
        logError(
          `[AgentRuntimeExtensionManager] onCommand failed for ${extension.name}:`,
          error,
        );
      }
    }
    return null;
  }

  async onSessionDeleted(context: SessionDeletedContext): Promise<void> {
    await Promise.allSettled(
      this.extensions.map(async (extension) => {
        if (!extension.onSessionDeleted) {
          return;
        }
        try {
          await extension.onSessionDeleted(context);
        } catch (error) {
          logError(
            `[AgentRuntimeExtensionManager] onSessionDeleted failed for ${extension.name}:`,
            error,
          );
        }
      }),
    );
  }
}
