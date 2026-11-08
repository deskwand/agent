import type {
  AgentRuntimeExtension,
  BeforeSessionRunContext,
  BeforeSessionRunResult,
} from "../extensions/agent-runtime-extension";
import { logError } from "../utils/logger";
import { MEMORY_POLICY_PROMPT } from "./memory-policy";
import type { MemoryService } from "./memory-service";
import type { TeammateMemoryRegistry } from "./teammate-memory-registry";

/** 伙伴会话的记忆路由：按会话 id 解析伙伴，再取其独立 MemoryService。 */
export interface TeammateMemoryRouting {
  registry: Pick<TeammateMemoryRegistry, "getForAgent">;
  resolveAgentId(sessionId: string): string | null;
  /** 项目 Bot 用全局记忆（作用域由 cwd 派生），不进伙伴的私有存储根。 */
  isProjectAgent?(agentId: string): boolean;
}

export class MemoryExtension implements AgentRuntimeExtension {
  readonly name = "memory";

  constructor(
    private readonly memoryService: MemoryService,
    private readonly teammates?: TeammateMemoryRouting,
  ) {}

  /** 普通会话 → 全局；伙伴会话 → 伙伴实例（查不到伙伴则不给记忆，绝不回退全局）。 */
  private pick(session: {
    id: string;
    kind?: string;
    memoryEnabled: boolean;
  }): MemoryService | null {
    if (!this.memoryService.isEnabled()) return null;
    if (session.kind !== "agent") {
      return session.memoryEnabled ? this.memoryService : null;
    }
    const agentId = this.teammates?.resolveAgentId(session.id);
    if (!agentId) return null;
    if (this.teammates?.isProjectAgent?.(agentId)) return this.memoryService;
    return this.teammates!.registry.getForAgent(agentId);
  }

  async beforeSessionRun({
    session,
  }: BeforeSessionRunContext): Promise<BeforeSessionRunResult | void> {
    const service = this.pick(session);
    if (!service) {
      return;
    }

    return {
      systemPromptSuffix: MEMORY_POLICY_PROMPT,
      customTools: service.getTools(session.cwd),
    };
  }

  async afterSessionRun({
    session,
    prompt,
    messages,
  }: Parameters<
    NonNullable<AgentRuntimeExtension["afterSessionRun"]>
  >[0]): Promise<void> {
    const service = this.pick(session);
    if (!service) {
      return;
    }
    try {
      void service
        .enqueueIngestion({
          // 伙伴会话恒为项目模式（memoryEnabled=false），但 ingest 会自查该字段
          session:
            session.kind === "agent"
              ? { ...session, memoryEnabled: true }
              : session,
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
