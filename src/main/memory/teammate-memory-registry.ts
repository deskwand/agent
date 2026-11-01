/**
 * @module main/memory/teammate-memory-registry
 *
 * 按伙伴 id 懒建独立的 MemoryService（存储根为 `<userData>/teammates/<id>/memory`）。
 */
import { getTeammateMemoryRoot } from "../agents/teammate-paths";
import type { DatabaseInstance } from "../db/database";
import type { MemoryLLMClientLike } from "./memory-llm-client";
import { MemoryService } from "./memory-service";

export class TeammateMemoryRegistry {
  private readonly services = new Map<string, MemoryService>();

  constructor(
    private readonly db: DatabaseInstance,
    private readonly userDataPath: string,
    private readonly options?: { llmClient?: MemoryLLMClientLike },
  ) {}

  getForAgent(agentId: string): MemoryService {
    let service = this.services.get(agentId);
    if (!service) {
      service = new MemoryService(this.db, {
        llmClient: this.options?.llmClient,
        storageRoot: getTeammateMemoryRoot(this.userDataPath, agentId),
      });
      this.services.set(agentId, service);
    }
    return service;
  }

  /** 排空后台写入并丢弃缓存，之后才可安全删除伙伴目录。 */
  async dispose(agentId: string): Promise<void> {
    const service = this.services.get(agentId);
    this.services.delete(agentId);
    await service?.drain();
  }
}
