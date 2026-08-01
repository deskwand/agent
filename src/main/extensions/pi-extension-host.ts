import {
  DefaultResourceLoader,
  DefaultPackageManager,
  SettingsManager,
  VERSION,
  type InlineExtension,
  type LoadExtensionsResult,
  type ResourceDiagnostic,
} from "@earendil-works/pi-coding-agent";
import type { PiTrustResolver } from "./pi-trust-resolver";
import * as path from "node:path";
import { log, logError, logWarn } from "../utils/logger";

export interface PiHostOptions {
  cwd: string;
  agentDir: string;
  additionalSkillPaths?: string[];
  appendSystemPrompt?: string[];
  inlineExtensionFactories?: InlineExtension[];
  /** 项目信任询问回调（null = 用户取消/放弃决定）。用于 resolveProjectTrust 链路。 */
  onTrustPrompt?: (cwd: string) => Promise<boolean | null>;
}

export interface PiReloadOptions {
  /** 是否在 reload 前解析项目信任（通过 onTrustPrompt + PiTrustResolver）。 */
  resolveProjectTrust?: boolean;
}

export interface PiRegisteredCommand {
  name: string;
  description?: string;
}

export class PiExtensionHost {
  static registry = new Map<string, PiExtensionHost>();
  static readonly MAX_REGISTRY_SIZE = 50;

  static getOrCreate(options: PiHostOptions): PiExtensionHost {
    const key = `${path.resolve(options.cwd)}|${path.resolve(options.agentDir)}`;
    let host = PiExtensionHost.registry.get(key);
    if (!host) {
      if (PiExtensionHost.registry.size >= PiExtensionHost.MAX_REGISTRY_SIZE) {
        // 简单淘汰：移除最早创建的 host（Map 插入序），避免长期运行内存增长
        const oldestKey = PiExtensionHost.registry.keys().next().value;
        if (oldestKey !== undefined) {
          const oldest = PiExtensionHost.registry.get(oldestKey);
          oldest?.dispose();
        }
      }
      host = new PiExtensionHost(options);
      PiExtensionHost.registry.set(key, host);
    }
    return host;
  }

  readonly cwd: string;
  readonly agentDir: string;
  private readonly registryKey: string;
  private readonly settingsManager: SettingsManager;
  private readonly packageManager: DefaultPackageManager;
  private readonly resourceLoader: DefaultResourceLoader;
  private readonly inlineExtensionFactories: InlineExtension[];
  private readonly onTrustPrompt?: (cwd: string) => Promise<boolean | null>;
  private trustResolver?: PiTrustResolver;

  private constructor(options: PiHostOptions) {
    this.cwd = path.resolve(options.cwd);
    this.agentDir = path.resolve(options.agentDir);
    this.registryKey = `${this.cwd}|${this.agentDir}`;
    this.onTrustPrompt = options.onTrustPrompt;
    this.settingsManager = SettingsManager.create(this.cwd, this.agentDir);
    this.packageManager = new DefaultPackageManager({
      cwd: this.cwd,
      agentDir: this.agentDir,
      settingsManager: this.settingsManager,
    });
    this.inlineExtensionFactories = [...(options.inlineExtensionFactories ?? [])];
    this.resourceLoader = new DefaultResourceLoader({
      cwd: this.cwd,
      agentDir: this.agentDir,
      settingsManager: this.settingsManager,
      additionalSkillPaths: options.additionalSkillPaths,
      appendSystemPrompt: options.appendSystemPrompt,
      extensionFactories: this.inlineExtensionFactories,
    });
  }

  getSettingsManager(): SettingsManager {
    return this.settingsManager;
  }

  getPackageManager(): DefaultPackageManager {
    return this.packageManager;
  }

  getResourceLoader(): DefaultResourceLoader {
    return this.resourceLoader;
  }

  getExtensionsResult(): LoadExtensionsResult {
    return this.resourceLoader.getExtensions();
  }

  getExtensionErrors(): { path: string; error: string }[] {
    return this.getExtensionsResult().errors.map((e) => ({
      path: e.path,
      error: e.error,
    }));
  }

  /**
   * 加载阶段可用的扩展命令（ExtensionRunner 尚未构造，
   * 直接读取各 Extension 的 commands map）。
   */
  getRegisteredCommands(): PiRegisteredCommand[] {
    const commands: PiRegisteredCommand[] = [];
    const commandSources: string[] = [];
    for (const ext of this.getExtensionsResult().extensions) {
      for (const [name, cmd] of ext.commands) {
        commands.push({ name, description: cmd.description });
        commandSources.push(ext.path);
      }
    }
    // 重名诊断：SDK 会对重名命令加 :occurrence 后缀（仅第一个经 /name 执行），
    // 记录各来源扩展路径，便于排查用户输入原始名不匹配的情况。
    const counts = new Map<string, string[]>();
    for (let i = 0; i < commands.length; i++) {
      const arr = counts.get(commands[i].name) ?? [];
      arr.push(commandSources[i]);
      counts.set(commands[i].name, arr);
    }
    for (const [name, paths] of counts) {
      if (paths.length > 1) {
        logWarn(
          `[PiExtensionHost] Duplicate command "${name}" from ${paths.length} extensions (${paths.join(", ")}); /${name} invokes the first, others via /${name}:N`,
        );
      }
    }
    return commands;
  }

  getDiagnostics(): ResourceDiagnostic[] {
    // 加载阶段仅 errors 可用；工具/命令/标志冲突已由 SDK loader 的
    // addExtensionConflictDiagnostics 合并进 errors（加载时无法拿到
    // ExtensionRunner 级诊断，后者需会话创建后）。
    return this.getExtensionsResult().errors.map((e) => ({
      type: "error" as const,
      message: e.error,
      path: e.path,
    }));
  }

  getCompatibleSdkVersion(): string {
    return VERSION;
  }

  async reloadResources(options?: PiReloadOptions): Promise<void> {
    try {
      if (options?.resolveProjectTrust) {
        await this.resolveTrustAndReload();
        return;
      }
      await this.resourceLoader.reload();
      log(
        `[PiExtensionHost] Reloaded resources for ${this.cwd}: ` +
          `${this.getExtensionsResult().extensions.length} extensions`,
      );
    } catch (error) {
      logError(`[PiExtensionHost] Resource reload failed for ${this.cwd}:`, error);
      throw error;
    }
  }

  /**
   * 信任解析链路（与 Pi 一致）：saved trust.json → defaultProjectTrust →
   * onTrustPrompt 询问用户。结果经 loader 的 resolveProjectTrust 门控
   * 项目级扩展/包加载。
   */
  private async resolveTrustAndReload(): Promise<void> {
    if (!this.onTrustPrompt) {
      await this.resourceLoader.reload();
      return;
    }
    const { PiTrustResolver } = await import("./pi-trust-resolver");
    this.trustResolver ??= new PiTrustResolver(this.agentDir);
    const trusted = await this.trustResolver.resolve({
      cwd: this.cwd,
      agentDir: this.agentDir,
      settingsManager: this.settingsManager,
      askUser: this.onTrustPrompt,
    });
    await this.resourceLoader.reload({
      resolveProjectTrust: async () => trusted === "trusted",
    });
    log(
      `[PiExtensionHost] Reloaded (trust=${trusted}) for ${this.cwd}: ` +
        `${this.getExtensionsResult().extensions.length} extensions`,
    );
  }

  dispose(): void {
    PiExtensionHost.registry.delete(this.registryKey);
  }
}
