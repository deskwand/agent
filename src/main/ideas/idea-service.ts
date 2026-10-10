import { IdeaStore } from "./idea-store";
import type {
  IdeaCreateInput,
  IdeaList,
  IdeaReadResult,
  IdeaStatus,
  IdeaSummary,
  IdeaUpdateResult,
} from "../../shared/ideas";

/**
 * 想法的编排点：渲染层（IPC）与 agent 工具都只经这里，不直接碰 store。
 *
 * 构造时不给参数 —— 路径由 store 自己从 `getIdeasRoot()` 取，服务不关心落在哪；
 * 测试里传一个指向临时目录的 store。
 */
export class IdeaService {
  constructor(private readonly store: IdeaStore = new IdeaStore()) {}

  list(): Promise<IdeaList> {
    return this.store.list();
  }

  read(name: string): Promise<IdeaReadResult> {
    return this.store.read(name);
  }

  create(input: IdeaCreateInput): Promise<IdeaSummary> {
    return this.store.create(input);
  }

  update(
    name: string,
    content: string,
    mtimeMs: number,
  ): Promise<IdeaUpdateResult> {
    return this.store.update(name, content, mtimeMs);
  }

  setStatus(name: string, status: IdeaStatus): Promise<IdeaSummary> {
    return this.store.setStatus(name, status);
  }

  remove(name: string): Promise<void> {
    return this.store.remove(name);
  }
}
