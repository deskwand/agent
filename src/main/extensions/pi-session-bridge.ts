import {
  SessionManager as PiSessionManager,
  type AgentSession as PiAgentSession,
  type ExtensionCommandContextActions,
} from "@earendil-works/pi-coding-agent";
import { logWarn } from "../utils/logger";

/**
 * 轻量替换上下文（SDK 的 ReplacedSessionContext 未从 root 导出）。
 * 实现扩展实际使用的 sendUserMessage/sendMessage（转发到新会话）
 * 与最小 ui 面（handoff.ts 等调用 ctx.ui.setEditorText）。
 */
export interface PiReplacedContext {
  sendUserMessage(content: string | unknown[]): Promise<void>;
  sendMessage(message: { content?: string; customType?: string }): Promise<void>;
  ui: {
    setEditorText(text: string): void;
    notify?(message: string, type?: "info" | "warning" | "error"): void;
  };
}

export interface PiSessionBridgeCallbacks {
  /** 会话关闭/切换时：关闭 TUI Modal、清 onTerminalInput 订阅。 */
  onSessionShutdownCleanup: () => void;
  /** 扩展 newSession/fork 时创建新 DeskWand 会话 + 关联 Pi SessionManager。 */
  createDeskWandSession?: (options: {
    cwd: string;
    title?: string;
    /** fork 场景：关联已分叉的 Pi session 文件（不新建空文件）。 */
    piSessionFile?: string;
  }) => Promise<{
    sessionId: string;
    piSessionManager: PiSessionManager;
    replacedContext: PiReplacedContext;
  } | null>;
  /** fork 场景：把 Pi branch 消息物化到 DeskWand 会话数据库。 */
  materializeMessages?: (
    sessionId: string,
    entries: unknown[],
  ) => Promise<void>;
  /** 按 Pi session 文件查找 DeskWand 会话（switchSession 用）。 */
  findDeskWandSessionByPiFile?: (piFile: string) => string | null;
  /** 通知 renderer 激活指定会话（switchSession 用）。 */
  activateSession?: (sessionId: string) => void;
  /** replacedContext 的 ui 适配（路由到现有 PiUiBridge）。 */
  uiAdapter?: {
    setEditorText(text: string): void;
    notify?(message: string, type?: "info" | "warning" | "error"): void;
  };
  /** 对已有会话发起 prompt（switchSession withSession 用）。 */
  enqueuePrompt?: (sessionId: string, prompt: string) => void;
}

/** 提取 entry 消息文本（用于 fork 的 selectedText）。 */
function extractEntryText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter((c): c is { type: string; text?: string } => c !== null && typeof c === "object")
    .map((c) => (c.type === "text" ? c.text ?? "" : ""))
    .join(" ")
    .trim();
  return text || undefined;
}

export class PiSessionBridge {
  constructor(
    private readonly session: PiAgentSession,
    private readonly callbacks: PiSessionBridgeCallbacks,
    private readonly cwd: string,
  ) {}

  buildCommandContextActions(): ExtensionCommandContextActions {
    return {
      waitForIdle: () => this.session.waitForIdle(),
      reload: async () => {
        await this.session.reload();
        // SDK reload 重建扩展 runner；UI 上下文需要由调用方重新绑定
        // （agent-runner 在 reload 后重新调用 bindExtensions）。
      },
      // Task 4/6 实现；navigateTree 明确降级（karpathy 评估：语义断裂）
      newSession: async (options) => {
        if (!this.callbacks.createDeskWandSession) {
          logWarn("[PiSessionBridge] newSession unavailable: no session factory");
          return { cancelled: true };
        }
        const created = await this.callbacks.createDeskWandSession({
          cwd: this.cwd,
          title: options?.parentSession ? "Extension fork" : "Extension session",
        });
        if (!created) return { cancelled: true };
        // setup：在新会话的 Pi SessionManager 上执行，随后物化到 DB
        //（否则写入孤儿 Pi 文件，实际运行时不会使用）
        if (options?.setup) {
          await options.setup(created.piSessionManager);
          if (this.callbacks.materializeMessages) {
            await this.callbacks.materializeMessages(
              created.sessionId,
              created.piSessionManager.getBranch(),
            );
          }
        }
        // withSession：在新会话的替换上下文执行（轻量桥接，SDK 语义）
        if (options?.withSession) {
          const ctx = {
            ...created.replacedContext,
            ui: this.callbacks.uiAdapter ?? { setEditorText: () => {}, notify: () => {} },
          };
          await options.withSession(ctx as never);
        }
        return { cancelled: false };
      },
      fork: async (entryId, options) => {
        if (!this.callbacks.createDeskWandSession) {
          logWarn("[PiSessionBridge] fork unavailable: no session factory");
          return { cancelled: true };
        }
        const position = options?.position ?? "before";
        const selectedEntry = this.session.sessionManager.getEntry(entryId);
        if (!selectedEntry) {
          logWarn("[PiSessionBridge] fork: invalid entry id", entryId);
          return { cancelled: true };
        }
        let targetLeafId: string | undefined;
        let selectedText: string | undefined;
        if (position === "at") {
          targetLeafId = selectedEntry.id;
        } else {
          if (
            selectedEntry.type !== "message" ||
            selectedEntry.message.role !== "user"
          ) {
            logWarn("[PiSessionBridge] fork: before-position requires a user message");
            return { cancelled: true };
          }
          targetLeafId = selectedEntry.parentId ?? undefined;
          selectedText = extractEntryText(selectedEntry.message.content);
        }
        const currentSessionFile = this.session.sessionFile;
        const sessionDir = this.session.sessionManager.getSessionDir();
        if (!currentSessionFile || !sessionDir) {
          logWarn("[PiSessionBridge] fork: session not persisted yet");
          return { cancelled: true };
        }
        let forkedPath: string | undefined;
        try {
          const opened = PiSessionManager.open(currentSessionFile, sessionDir);
          forkedPath = targetLeafId
            ? opened.createBranchedSession(targetLeafId)
            : undefined;
        } catch (error) {
          logWarn("[PiSessionBridge] fork: createBranchedSession threw:", error);
          return { cancelled: true };
        }
        if (!forkedPath) {
          logWarn("[PiSessionBridge] fork: createBranchedSession failed");
          return { cancelled: true };
        }
        const created = await this.callbacks.createDeskWandSession({
          cwd: this.cwd,
          title: "Extension fork",
          piSessionFile: forkedPath,
        });
        if (!created) return { cancelled: true };
        // 物化：新 Pi session 的 branch 消息 → DeskWand 数据库
        if (this.callbacks.materializeMessages) {
          const forkedManager = PiSessionManager.open(forkedPath, sessionDir);
          await this.callbacks.materializeMessages(
            created.sessionId,
            forkedManager.getBranch(),
          );
        }
        if (options?.withSession) {
          const ctx = {
            ...created.replacedContext,
            ui: this.callbacks.uiAdapter ?? { setEditorText: () => {}, notify: () => {} },
          };
          await options.withSession(ctx as never);
        }
        return { cancelled: false, selectedText };
      },
      navigateTree: async () => {
        logWarn(
          "[PiSessionBridge] navigateTree unsupported: deskwand context comes from DB messages, not pi branches",
        );
        return { cancelled: true };
      },
      switchSession: async (sessionPath, options) => {
        if (!this.callbacks.createDeskWandSession) {
          logWarn("[PiSessionBridge] switchSession unavailable");
          return { cancelled: true };
        }
        // 1. 按 pi_session_file 查找已有 DeskWand 会话
        const existing = this.callbacks.findDeskWandSessionByPiFile?.(
          sessionPath,
        );
        if (existing) {
          this.callbacks.activateSession?.(existing);
          if (options?.withSession) {
            const ctx = {
              sendUserMessage: async (content: string | unknown[]) => {
                const text =
                  typeof content === "string"
                    ? content
                    : JSON.stringify(content);
                this.callbacks.enqueuePrompt?.(existing, text);
              },
              sendMessage: async () => {},
              ui: this.callbacks.uiAdapter ?? { setEditorText: () => {}, notify: () => {} },
            };
            await options.withSession(ctx as never);
          }
          return { cancelled: false };
        }
        // 2. 无关联 → 先验证文件存在，再创建会话 + 物化 + 激活
        const fs = await import("node:fs");
        if (!fs.existsSync(sessionPath)) {
          logWarn("[PiSessionBridge] switchSession: file not found", sessionPath);
          return { cancelled: true };
        }
        const sessionDir = this.session.sessionManager?.getSessionDir?.();
        let created: {
          sessionId: string;
          piSessionManager: PiSessionManager;
          replacedContext: PiReplacedContext;
        } | null = null;
        try {
          created = await this.callbacks.createDeskWandSession({
            cwd: this.cwd,
            title: "Extension session",
            piSessionFile: sessionPath,
          });
          if (!created) return { cancelled: true };
          if (this.callbacks.materializeMessages && sessionDir) {
            const target = PiSessionManager.open(sessionPath, sessionDir);
            await this.callbacks.materializeMessages(
              created.sessionId,
              target.getBranch(),
            );
          }
        } catch (error) {
          logWarn("[PiSessionBridge] switchSession failed:", error);
          return { cancelled: true };
        }
        this.callbacks.activateSession?.(created.sessionId);
        if (options?.withSession) {
          const ctx = {
            ...created.replacedContext,
            ui: this.callbacks.uiAdapter ?? { setEditorText: () => {}, notify: () => {} },
          };
          await options.withSession(ctx as never);
        }
        return { cancelled: false };
      },
    };
  }

  dispose(): void {
    this.callbacks.onSessionShutdownCleanup();
  }
}
