import type {
  AgentRuntimeExtension,
  BeforeSessionRunContext,
  BeforeSessionRunResult,
} from "../extensions/agent-runtime-extension";
import { logError } from "../utils/logger";
import { MEMORY_POLICY_PROMPT } from "./memory-policy";
import type { MemoryService } from "./memory-service";

export class MemoryExtension implements AgentRuntimeExtension {
  readonly name = "memory";

  constructor(private readonly memoryService: MemoryService) {}

  async beforeSessionRun({
    session,
  }: BeforeSessionRunContext): Promise<BeforeSessionRunResult | void> {
    if (!this.memoryService.isEnabled() || !session.memoryEnabled) {
      return;
    }

    return {
      systemPromptSuffix: MEMORY_POLICY_PROMPT,
      customTools: this.memoryService.getTools(session.cwd),
    };
  }

  async afterSessionRun({
    session,
    prompt,
    messages,
  }: Parameters<
    NonNullable<AgentRuntimeExtension["afterSessionRun"]>
  >[0]): Promise<void> {
    if (!this.memoryService.isEnabled() || !session.memoryEnabled) {
      return;
    }
    try {
      void this.memoryService
        .enqueueIngestion({
          session,
          prompt,
          messages,
        })
        .catch((error) => {
          logError("[MemoryExtension] Background ingestion failed:", error);
        });
    } catch (error) {
      logError("[MemoryExtension] Background ingestion failed:", error);
    }
  }

  async onSessionDeleted({
    sessionId,
  }: Parameters<
    NonNullable<AgentRuntimeExtension["onSessionDeleted"]>
  >[0]): Promise<void> {
    await this.memoryService.deleteSession(sessionId);
  }
}
