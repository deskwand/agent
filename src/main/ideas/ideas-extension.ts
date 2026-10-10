import type {
  AgentRuntimeExtension,
  BeforeSessionRunContext,
  BeforeSessionRunResult,
} from "../extensions/agent-runtime-extension";
import type { IdeaService } from "./idea-service";
import { createIdeaTools } from "./idea-tools";

/**
 * 把灵感工具挂进会话。
 *
 * **只给 `customTools`，不给 `systemPromptSuffix`** —— 系统提示一个字都不改，
 * 提示词缓存因此不受本功能影响（`MemoryExtension` 那条会加 policy 提示，这里不跟）。
 */
export class IdeasExtension implements AgentRuntimeExtension {
  readonly name = "ideas";

  constructor(private readonly service: IdeaService) {}

  async beforeSessionRun(
    _context: BeforeSessionRunContext,
  ): Promise<BeforeSessionRunResult> {
    return { customTools: createIdeaTools(this.service) };
  }
}
