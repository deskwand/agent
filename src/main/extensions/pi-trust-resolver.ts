import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { log } from "../utils/logger";

export type TrustDecision = "trusted" | "untrusted" | "undecided";

/** 结构化依赖：只要求 getDefaultProjectTrust（避免依赖整个 SettingsManager）。 */
export interface TrustSettingsSource {
  getDefaultProjectTrust(): "ask" | "always" | "never";
}

export interface ResolveTrustInput {
  cwd: string;
  agentDir: string;
  settingsManager: TrustSettingsSource;
  askUser: (cwd: string) => Promise<boolean | null>;
}

export class PiTrustResolver {
  private readonly store: ProjectTrustStore;

  constructor(agentDir: string) {
    this.store = new ProjectTrustStore(agentDir);
  }

  writeDecision(cwd: string, decision: boolean): void {
    this.store.set(cwd, decision);
  }

  async resolve(input: ResolveTrustInput): Promise<TrustDecision> {
    // ① 已保存决定
    const saved = this.store.get(input.cwd);
    if (saved !== null) {
      return saved ? "trusted" : "untrusted";
    }
    // ② 全局扩展 project_trust hook：P0 不接入 SDK hook
    //    （emitProjectTrustEvent 未从 root 导出），记为 undecided 交由后续步骤。
    // ③ defaultProjectTrust
    const policy = input.settingsManager.getDefaultProjectTrust();
    if (policy === "always") return "trusted";
    if (policy === "never") return "untrusted";
    // ④ 询问用户
    const answer = await input.askUser(input.cwd);
    if (answer === null) return "undecided";
    this.writeDecision(input.cwd, answer);
    log(`[PiTrustResolver] ${answer ? "Trusted" : "Untrusted"} ${input.cwd}`);
    return answer ? "trusted" : "untrusted";
  }
}
