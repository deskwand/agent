/**
 * @module main/agent/agent-runner
 *
 * AI query execution engine (1514 lines).
 *
 * Responsibilities:
 * - Runs AI conversations via the pi-coding-agent SDK (createAgentSession)
 * - Routes providers via pi-ai SDK for model resolution
 * - Bridges MCP tools into SDK ToolDefinition format
 * - Streams responses back as ServerEvents (stream.message, stream.partial, trace.step)
 * - Skills injection, system prompt assembly, permission handling
 *
 * Dependencies: session-manager, mcp-manager, config-store, skills-manager
 */
import {
  createAgentSession,
  SessionManager as PiSessionManager,
  SettingsManager as PiSettingsManager,
  createCodingTools,
  type AgentSession as PiAgentSession,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "@sinclair/typebox";
import { getSharedAuthStorage, ModelRegistry } from "./shared-auth";
import type {
  Session,
  Message,
  TraceStep,
  ServerEvent,
  ContentBlock,
} from "../../renderer/types";
import { v4 as uuidv4 } from "uuid";
import { PathResolver } from "../sandbox/path-resolver";
import { MCPManager } from "../mcp/mcp-manager";
import { mcpConfigStore } from "../mcp/mcp-config-store";
import {
  log,
  logWarn,
  logError,
  logCtx,
  logCtxWarn,
  logCtxError,
  logTiming,
} from "../utils/logger";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execFileSync, spawn } from "child_process";
import { app } from "electron";
import { setMaxListeners } from "node:events";
import { getSandboxAdapter } from "../sandbox/sandbox-adapter";
import { pathConverter } from "../sandbox/wsl-bridge";
import { SandboxSync } from "../sandbox/sandbox-sync";
import {
  extractArtifactsFromText,
  buildArtifactTraceSteps,
} from "../utils/artifact-parser";
import { getDefaultShell } from "../utils/shell-resolver";
import type { SkillsAdapter } from "../skills/skills-adapter";
import { AgentRuntimeExtensionManager } from "../extensions/agent-runtime-extension-manager";
import { configStore } from "../config/config-store";
import {
  BrowserViewManager,
  BROWSER_CDP_PORT,
} from "../browser/browser-view-manager";
import { TurnFinalizer, type TurnFinalizerOptions } from "./turn-finalizer";
import type { Browser, Page, Locator } from "playwright-core";
import {
  resolveMessageEndPayload,
  toUserFacingErrorText,
} from "./agent-runner-message-end";
import { buildPiSessionRuntimeSignature } from "./pi-session-runtime";
import { ThinkTagStreamParser } from "./think-tag-parser";
import {
  normalizeMcpToolResultForModel,
  normalizeToolExecutionResultForUi,
} from "./tool-result-utils";
import { modelResolutionService } from "../model/model-resolution-service";

// Virtual workspace path shown to the model (hides real sandbox path)
const VIRTUAL_WORKSPACE_PATH = "/workspace";

/**
 * Estimate chars-per-token ratio based on content language.
 * CJK characters tokenize at ~1.5 chars/token vs ~4 for English.
 */
function estimateCharsPerToken(sampleText: string): number {
  if (!sampleText || sampleText.length === 0) return 4;
  const sample = sampleText.substring(0, 500);
  const cjkCount = (
    sample.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) ||
    []
  ).length;
  const cjkRatio = cjkCount / sample.length;
  return 4 - cjkRatio * 2.5; // Range: 1.5 (pure CJK) ~ 4 (pure English)
}

// Bundled node/npx paths never change at runtime — resolve once.
let cachedBundledNodePaths: { node: string; npx: string } | null | undefined =
  undefined;

function getBundledNodePaths(): { node: string; npx: string } | null {
  if (cachedBundledNodePaths !== undefined) {
    return cachedBundledNodePaths;
  }
  const platform = process.platform;
  const arch = process.arch;
  let resourcesPath: string;
  if (!app.isPackaged) {
    const projectRoot = path.join(__dirname, "..", "..");
    resourcesPath = path.join(
      projectRoot,
      "resources",
      "node",
      `${platform}-${arch}`,
    );
  } else {
    resourcesPath = path.join(process.resourcesPath, "node");
  }
  const binDir =
    platform === "win32" ? resourcesPath : path.join(resourcesPath, "bin");
  const nodePath = path.join(
    binDir,
    platform === "win32" ? "node.exe" : "node",
  );
  const npxPath = path.join(binDir, platform === "win32" ? "npx.cmd" : "npx");
  cachedBundledNodePaths =
    fs.existsSync(nodePath) && fs.existsSync(npxPath)
      ? { node: nodePath, npx: npxPath }
      : null;
  return cachedBundledNodePaths;
}

/**
 * Resolve bundled Python bin directory path (if available).
 * Checks packaged and dev layouts, returns the bin dir containing python3.
 */
function resolveBundledPythonBinDir(): string | null {
  const platform = process.platform;
  const arch = process.arch === "arm64" ? "arm64" : "x64";

  const candidates: string[] = [];
  if (!app.isPackaged) {
    const projectRoot = path.join(__dirname, "..", "..");
    if (platform === "darwin") {
      candidates.push(
        path.join(projectRoot, "resources", "python", `darwin-${arch}`, "bin"),
      );
    }
    candidates.push(path.join(projectRoot, "resources", "python", "bin"));
  } else {
    // Packaged layout: Resources/python/bin/python3
    candidates.push(path.join(process.resourcesPath, "python", "bin"));
  }

  const pythonExe = platform === "win32" ? "python.exe" : "python3";
  for (const binDir of candidates) {
    if (fs.existsSync(path.join(binDir, pythonExe))) return binDir;
  }
  return null;
}

/**
 * Resolve bundled tools directory (cliclick etc., macOS only).
 */
function resolveBundledToolsBinDir(): string | null {
  if (process.platform !== "darwin") return null;
  const arch = process.arch === "arm64" ? "arm64" : "x64";

  const candidates: string[] = [];
  if (!app.isPackaged) {
    const projectRoot = path.join(__dirname, "..", "..");
    candidates.push(
      path.join(projectRoot, "resources", "tools", `darwin-${arch}`, "bin"),
    );
    candidates.push(path.join(projectRoot, "resources", "tools", "bin"));
  } else {
    candidates.push(
      path.join(process.resourcesPath, "tools", `darwin-${arch}`, "bin"),
    );
    candidates.push(path.join(process.resourcesPath, "tools", "bin"));
  }

  for (const binDir of candidates) {
    if (fs.existsSync(binDir)) return binDir;
  }
  return null;
}

/**
 * One-time enrichment of process.env.PATH for build (production) mode.
 *
 * In dev mode, Electron inherits the user's full shell PATH, so Skill commands
 * like `python3` and `node` just work. In build mode, `process.env.PATH` is
 * minimal (often just `/usr/bin:/bin`).
 *
 * This function:
 * 1. Restores the user's login-shell PATH (safe: uses execFileSync, not execSync)
 * 2. Prepends bundled Node, Python, and tools bin dirs (highest priority)
 * 3. Deduplicates all entries
 * 4. Writes the result back to `process.env.PATH`
 *
 * Called once before the first `createCodingTools()` — subsequent calls are no-ops.
 */
let pathEnriched = false;

async function enrichProcessPathForBuild(): Promise<void> {
  if (pathEnriched) return;
  pathEnriched = true;

  if (!app.isPackaged) {
    log("[AgentRunner] Dev mode — skipping PATH enrichment");
    return;
  }

  const platform = process.platform;
  const delimiter = platform === "win32" ? ";" : ":";
  const currentPaths = (process.env.PATH || "")
    .split(delimiter)
    .filter((p: string) => p.trim());

  // 1. Restore user's login-shell PATH
  let shellPaths: string[] = [];
  if (platform === "darwin" || platform === "linux") {
    try {
      const shell = getDefaultShell();
      const output = (
        execFileSync(shell, ["-l", "-c", "echo $PATH"], {
          encoding: "utf-8",
          timeout: 5000,
          env: { ...process.env, HOME: os.homedir() },
        }) as string
      ).trim();
      if (output) {
        shellPaths = output.split(":").filter((p: string) => p.trim());
        log(
          `[AgentRunner] Restored ${shellPaths.length} paths from login shell`,
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn(`[AgentRunner] Could not restore shell PATH: ${message}`);
    }
  } else if (platform === "win32") {
    try {
      const output = (
        execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            "[Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')",
          ],
          { encoding: "utf-8", timeout: 5000 },
        ) as string
      ).trim();
      if (output) {
        shellPaths = output.split(";").filter((p: string) => p.trim());
        log(
          `[AgentRunner] Restored ${shellPaths.length} paths from Windows registry`,
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn(`[AgentRunner] Could not restore Windows PATH: ${message}`);
    }
  }

  // 2. Collect bundled bin directories (highest priority)
  const bundledDirs: string[] = [];

  const nodePaths = getBundledNodePaths();
  if (nodePaths) {
    bundledDirs.push(path.dirname(nodePaths.node));
  }

  const pythonBinDir = resolveBundledPythonBinDir();
  if (pythonBinDir) {
    bundledDirs.push(pythonBinDir);
  }

  const toolsBinDir = resolveBundledToolsBinDir();
  if (toolsBinDir) {
    bundledDirs.push(toolsBinDir);
  }

  // 3. Merge: bundled (highest) → shell → current process, deduplicate
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const p of [...bundledDirs, ...shellPaths, ...currentPaths]) {
    const normalized = platform === "win32" ? p.toLowerCase() : p;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      merged.push(p);
    }
  }

  process.env.PATH = merged.join(delimiter);
  log(
    `[AgentRunner] Enriched process.env.PATH for build mode: ${bundledDirs.length} bundled + ${shellPaths.length} shell + ${currentPaths.length} process → ${merged.length} total`,
  );
}

// Shared pi-ai auth storage — created once, reused across sessions.

/**
 * Bridge MCP tools from MCPManager into pi-coding-agent ToolDefinition[] format.
 * Each MCP tool becomes a customTool whose execute() delegates to mcpManager.callTool().
 */
function buildMcpCustomTools(mcpManager: MCPManager): ToolDefinition[] {
  const mcpTools = mcpManager.getTools();
  return mcpTools.map((mcpTool) => {
    // Wrap the raw JSON Schema inputSchema as a TypeBox TSchema
    const parameters = Type.Unsafe<Record<string, unknown>>(
      mcpTool.inputSchema as Record<string, unknown>,
    );

    const toolDef: ToolDefinition<TSchema, unknown> = {
      name: mcpTool.name,
      label: mcpTool.name.replace(/^mcp__/, "").replace(/__/g, " → "),
      description: mcpTool.description || `MCP tool from ${mcpTool.serverName}`,
      parameters,
      async execute(
        _toolCallId: any,
        params: any,
        _signal: any,
        _onUpdate: any,
        _ctx: any,
      ) {
        try {
          const result = await mcpManager.callTool(
            mcpTool.name,
            params as Record<string, unknown>,
          );
          const normalizedResult = normalizeMcpToolResultForModel(result);
          return {
            content: [{ type: "text" as const, text: normalizedResult.text }],
            details:
              normalizedResult.images.length > 0
                ? { openCoworkImages: normalizedResult.images }
                : undefined,
          };
        } catch (err: unknown) {
          logError(`[AgentRunner] MCP tool ${mcpTool.name} failed:`, err);
          throw err instanceof Error ? err : new Error(String(err));
        }
      },
    };
    return toolDef;
  });
}

/**
 * Get shell environment with proper PATH (including node, npm, etc.)
 * GUI apps on macOS don't inherit shell PATH, so we need to extract it
 */

function safeStringify(value: unknown, space = 0): string {
  try {
    return JSON.stringify(value, null, space);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    return `[Unserializable: ${details}]`;
  }
}

function summarizeMessageForLog(message: unknown): Record<string, unknown> {
  if (!message || typeof message !== "object") {
    return { present: false };
  }

  const typedMessage = message as {
    role?: unknown;
    stopReason?: unknown;
    content?: unknown[];
    usage?: unknown;
  };
  const content = Array.isArray(typedMessage.content)
    ? typedMessage.content
    : [];

  return {
    present: true,
    role: typeof typedMessage.role === "string" ? typedMessage.role : undefined,
    stopReason: typedMessage.stopReason ?? undefined,
    contentBlocks: content.length,
    contentTypes: content.slice(0, 8).map((block) => {
      if (!block || typeof block !== "object") {
        return typeof block;
      }
      const type = (block as { type?: unknown }).type;
      return typeof type === "string" ? type : "unknown";
    }),
    usage: normalizeTokenUsage(typedMessage.usage),
  };
}

function toErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim()) {
      return maybeMessage;
    }
  }
  const serialized = safeStringify(error);
  if (serialized.startsWith("[Unserializable:")) {
    return String(error);
  }
  return serialized;
}

function normalizeTokenUsage(
  usage: unknown,
  provider?: string,
): Message["tokenUsage"] | undefined {
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  const raw = usage as {
    input?: unknown;
    output?: unknown;
    input_tokens?: unknown;
    output_tokens?: unknown;
    inputTokens?: unknown;
    outputTokens?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
    cache_read_input_tokens?: unknown;
    cacheReadInputTokens?: unknown;
    cacheWriteInputTokens?: unknown;
    cache_creation_input_tokens?: unknown;
    input_token_details?: {
      cached_tokens?: unknown;
      cache_read_input_tokens?: unknown;
      cache_write_tokens?: unknown;
    };
    usage?: {
      inputTokenDetails?: {
        cachedTokens?: unknown;
      };
    };
  };

  const input = raw.input ?? raw.input_tokens ?? raw.inputTokens;
  const output = raw.output ?? raw.output_tokens ?? raw.outputTokens;

  if (typeof input !== "number" || typeof output !== "number") {
    return undefined;
  }

  const cacheReadCandidates = [
    raw.cacheRead,
    raw.cache_read_input_tokens,
    raw.cacheReadInputTokens,
    raw.input_token_details?.cached_tokens,
    raw.input_token_details?.cache_read_input_tokens,
    raw.usage?.inputTokenDetails?.cachedTokens,
  ];
  const cacheReadRaw = cacheReadCandidates.find(
    (value) => typeof value === "number",
  );
  const cacheRead =
    typeof cacheReadRaw === "number" && cacheReadRaw >= 0
      ? Math.floor(cacheReadRaw)
      : undefined;

  const cacheWriteCandidates = [
    raw.cacheWrite,
    raw.cacheWriteInputTokens,
    raw.cache_creation_input_tokens,
    raw.input_token_details?.cache_write_tokens,
  ];
  const cacheWriteRaw = cacheWriteCandidates.find(
    (value) => typeof value === "number",
  );
  const cacheWrite =
    typeof cacheWriteRaw === "number" && cacheWriteRaw >= 0
      ? Math.floor(cacheWriteRaw)
      : undefined;

  // Provider semantics: Anthropic's input includes cacheRead; OpenAI's input excludes both cacheRead and cacheWrite.
  // We need totalPromptInput = the full prompt tokens sent (what counts against the context window).
  const isAnthropic =
    provider === "anthropic" || provider === "cloudflare-ai-gateway";
  const totalPromptInput = isAnthropic
    ? Math.floor(input) // input already includes cacheRead
    : Math.floor(input) + (cacheRead ?? 0) + (cacheWrite ?? 0); // input = prompt_tokens - cacheRead - cacheWrite

  return {
    input: Math.floor(input),
    output: Math.floor(output),
    totalPromptInput,
    ...(typeof cacheRead === "number" ? { cacheRead } : {}),
    ...(typeof cacheWrite === "number" ? { cacheWrite } : {}),
  };
}

interface AgentRunnerOptions {
  sendToRenderer: (event: ServerEvent) => void;
  saveMessage?: (message: Message) => void;
  requestSudoPassword?: (
    sessionId: string,
    toolUseId: string,
    command: string,
  ) => Promise<string | null>;
  /** Turn finalizer options (for background skill/memory review). */
  turnFinalizer?: TurnFinalizerOptions;
  /** Extra tools to register beyond the standard set. Used by background review. */
  customTools?: ToolDefinition[];
}

interface CachedPiSession {
  session: PiAgentSession;
  modelId: string;
  thinkingLevel: string;
  runtimeSignature: string;
  skillsSignature?: string;
  toolsSignature?: string;
  ollamaNumCtx?: { value: number };
  /** Extension commands registered via pi.registerCommand (e.g. /subagents-doctor) */
  extensionCommands?: { name: string; description: string }[];
}

/**
 * AgentRunner - Uses @earendil-works/pi-coding-agent SDK
 *
 * Environment variables should be set before running:
 *   ANTHROPIC_BASE_URL=https://openrouter.ai/api
 *   ANTHROPIC_AUTH_TOKEN=your_openrouter_api_key
 *   ANTHROPIC_API_KEY="" (must be empty)
 */
export class AgentRunner {
  private sendToRenderer: (event: ServerEvent) => void;
  private saveMessage?: (message: Message) => void;
  private requestSudoPassword?: (
    sessionId: string,
    toolUseId: string,
    command: string,
  ) => Promise<string | null>;
  private pathResolver: PathResolver;
  private mcpManager?: MCPManager;
  private _skillsAdapter?: SkillsAdapter;
  private extensionManager?: AgentRuntimeExtensionManager;
  private _browserViewManager: BrowserViewManager | null = null;
  private _browser: Browser | null = null;
  private _browserPage: Page | null = null;
  private _snapshotRefMap: Map<string, { role: string; name?: string; placeholder?: string; value?: string }> | null = null;
  private activeControllers: Map<string, AbortController> = new Map();
  private piSessions: Map<string, CachedPiSession> = new Map();
  private _turnFinalizer: TurnFinalizer | null = null;
  private _customTools: ToolDefinition[] = [];
  private static readonly MAX_CACHED_SESSIONS = 50;

  // Per-instance caches — invalidated when the underlying config changes.
  private _mcpServersCache: {
    fingerprint: string;
    servers: Record<string, unknown>;
  } | null = null;
  private _skillsSetupDone = false;
  private _skillsSetupInProgress = false;

  /**
   * Clear SDK session cache for a session
   * Called when session's cwd changes - SDK sessions are bound to cwd
   */
  clearSdkSession(sessionId: string): void {
    const cached = this.piSessions.get(sessionId);
    if (cached) {
      try {
        cached.session.dispose();
      } catch (e) {
        logWarn("[AgentRunner] dispose error:", e);
      }
      this.piSessions.delete(sessionId);
      log("[AgentRunner] Disposed pi session for:", sessionId);
    }
  }

  clearAllSdkSessions(): void {
    for (const sessionId of Array.from(this.piSessions.keys())) {
      this.clearSdkSession(sessionId);
    }
  }

  /** Call after the user installs / removes a skill / plugin so the next query re-links everything. */
  invalidateSkillsSetup(): void {
    this._skillsSetupDone = false;
    this._skillsSetupInProgress = false;
    // Clear all cached pi sessions so they are recreated with fresh
    // extension commands on the next message. Without this, an existing
    // session would reuse its stale ExtensionRunner and never see newly
    // installed plugin commands (e.g. /subagents-doctor).
    this.clearAllSdkSessions();
  }

  /** Call after the user changes MCP server config so the next query rebuilds mcpServers. */
  invalidateMcpServersCache(): void {
    this._mcpServersCache = null;
    // Sessions stay alive — MCP tools are rebuilt each query via buildMcpCustomTools()
    log(
      "[AgentRunner] MCP servers cache invalidated — tools will rebuild on next query",
    );
  }

  /**
   * Return extension commands from all active cached sessions.
   * Only commands from sessions that have gone through createAgentSession
   * are included, so the menu reflects what can actually be intercepted.
   */
  getExtensionCommands(): { name: string; description: string }[] {
    const seen = new Set<string>();
    const result: { name: string; description: string }[] = [];
    for (const cached of this.piSessions.values()) {
      for (const cmd of cached.extensionCommands ?? []) {
        if (seen.has(cmd.name)) continue;
        seen.add(cmd.name);
        result.push(cmd);
      }
    }
    return result;
  }

  // TODO: Credentials should be served via a secure MCP tool or IPC channel,
  // not injected as plaintext into the system prompt. The getCredentialsPrompt()
  // method was removed to eliminate credential leakage risk.

  /**
   * Generate bundled executable path hints for production mode system prompt.
   * In dev mode returns empty string (user PATH already works).
   * This is a defense-in-depth layer — even if PATH enrichment works, explicit
   * paths help the model avoid ambiguity when Skills reference bare commands.
   */
  private getBundledPathHints(): string {
    if (!app.isPackaged) return "";

    const hints: string[] = [];

    const nodePaths = getBundledNodePaths();
    if (nodePaths) {
      hints.push(`- node: ${nodePaths.node}`);
      hints.push(`- npx: ${nodePaths.npx}`);
    }

    const pythonBinDir = resolveBundledPythonBinDir();
    if (pythonBinDir) {
      const pythonExe = process.platform === "win32" ? "python.exe" : "python3";
      const pipExe = process.platform === "win32" ? "pip.exe" : "pip3";
      hints.push(`- python3: ${path.join(pythonBinDir, pythonExe)}`);
      if (fs.existsSync(path.join(pythonBinDir, pipExe))) {
        hints.push(`- pip3: ${path.join(pythonBinDir, pipExe)}`);
      }
    }

    if (hints.length === 0) return "";

    return `<bundled_executables>
This application bundles its own executables. When executing commands, prefer these absolute paths:
${hints.join("\n")}
</bundled_executables>`;
  }

  /** Fallback skill path resolution when SkillsAdapter is not provided. */
  private legacySkillPaths(): string[] {
    const paths: string[] = [];
    const builtin = this.getBuiltinSkillsPath();
    if (builtin && fs.existsSync(builtin)) paths.push(builtin);
    const global = this.getRuntimeSkillsDir();
    if (global && fs.existsSync(global)) paths.push(global);
    return paths;
  }

  private async resolveSkillPaths(): Promise<{
    skillPaths: string[];
    extensionPaths: string[];
  }> {
    const basePaths = this._skillsAdapter
      ? this._skillsAdapter.getSkillPaths()
      : this.legacySkillPaths();
    const mergedPaths = new Set(
      basePaths.filter((item): item is string =>
        Boolean(item && fs.existsSync(item)),
      ),
    );

    return {
      skillPaths: Array.from(mergedPaths),
      extensionPaths: [], // pi SDK manages extensions via settings.json
    };
  }

  /**
   * Get the built-in skills directory (shipped with the app)
   */
  private getBuiltinSkillsPath(): string {
    // In development, skills are in the project's .deskwand/skills directory
    // In production, they're extracted via extraResources to resources/skills
    const appPath = app.getAppPath();
    const unpackedPath = appPath.replace(/\.asar$/, ".asar.unpacked");

    const possiblePaths = [
      // Development: relative to this file
      path.join(__dirname, "..", "..", "..", ".deskwand", "skills"),
      // Production: extraResources extracts .deskwand/skills → resources/skills
      // This is the preferred production path (real directory, no asar issues)
      path.join(process.resourcesPath || "", "skills"),
      // Legacy: in app.asar.unpacked (for older builds with asarUnpack)
      ...(this.physicalDirExists(path.join(unpackedPath, ".deskwand", "skills"))
        ? [path.join(unpackedPath, ".deskwand", "skills")]
        : []),
      // Last resort: read from inside the asar archive (Electron intercepts this)
      path.join(appPath, ".deskwand", "skills"),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        log("[AgentRunner] Found built-in skills at:", p);
        return p;
      }
    }

    logWarn("[AgentRunner] No built-in skills directory found");
    return "";
  }

  /**
   * Check if a directory physically exists on disk, bypassing Electron's
   * asar interception.
   */
  private physicalDirExists(dirPath: string): boolean {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const originalFs = require("original-fs") as typeof import("fs");
      return (
        originalFs.existsSync(dirPath) &&
        originalFs.statSync(dirPath).isDirectory()
      );
    } catch {
      return false;
    }
  }

  private getAppDeskWandDir(): string {
    return app.getPath("userData");
  }

  private getRuntimeSkillsDir(): string {
    return path.join(app.getPath("home"), ".deskwand", "skills");
  }

  private getUserDeskWandSkillsDir(): string {
    return path.join(app.getPath("home"), ".deskwand", "skills");
  }

  private syncUserSkillsToAppDir(appSkillsDir: string): void {
    const userSkillsDir = this.getUserDeskWandSkillsDir();
    if (!fs.existsSync(userSkillsDir)) {
      return;
    }

    const entries = fs.readdirSync(userSkillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sourcePath = path.join(userSkillsDir, entry.name);
      const targetPath = path.join(appSkillsDir, entry.name);

      if (fs.existsSync(targetPath)) {
        try {
          const stat = fs.lstatSync(targetPath);
          if (!stat.isSymbolicLink()) {
            continue;
          }
          fs.unlinkSync(targetPath);
        } catch {
          continue;
        }
      }

      try {
        fs.symlinkSync(sourcePath, targetPath, "dir");
      } catch (err) {
        try {
          this.copyDirectorySync(sourcePath, targetPath);
        } catch (copyErr) {
          logWarn(
            "[AgentRunner] Failed to import user skill:",
            entry.name,
            copyErr,
          );
        }
      }
    }
  }

  private copyDirectorySync(source: string, target: string): void {
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }

    const entries = fs.readdirSync(source);
    for (const entry of entries) {
      const sourcePath = path.join(source, entry);
      const targetPath = path.join(target, entry);
      const stat = fs.statSync(sourcePath);

      if (stat.isDirectory()) {
        this.copyDirectorySync(sourcePath, targetPath);
      } else {
        fs.copyFileSync(sourcePath, targetPath);
      }
    }
  }

  constructor(
    options: AgentRunnerOptions,
    pathResolver: PathResolver,
    mcpManager?: MCPManager,
    skillsAdapter?: SkillsAdapter,
    extensionManager?: AgentRuntimeExtensionManager,
    browserViewManager?: BrowserViewManager,
  ) {
    this.sendToRenderer = options.sendToRenderer;
    this.saveMessage = options.saveMessage;
    this.requestSudoPassword = options.requestSudoPassword;
    this.pathResolver = pathResolver;
    this.mcpManager = mcpManager;
    this._skillsAdapter = skillsAdapter;
    this.extensionManager = extensionManager;
    this._browserViewManager = browserViewManager ?? null;

    log("[AgentRunner] Initialized with pi-coding-agent SDK");
    log(
      "[AgentRunner] Skills enabled: settingSources=[user, project], Skill tool enabled",
    );
    if (mcpManager) {
      log("[AgentRunner] MCP support enabled");
    }
    if (this._browserViewManager) {
      log("[AgentRunner] Internal browser support enabled");
    }
    if (options.turnFinalizer) {
      this._turnFinalizer = new TurnFinalizer(options.turnFinalizer);
      log("[AgentRunner] Turn finalizer (background review) enabled");
    }
    this._customTools = options.customTools || [];
  }

  // ---- browser automation (Playwright over CDP) ----

  private _isRetryableBrowserPageError(error: unknown): boolean {
    const text = toErrorText(error).toLowerCase();
    return (
      text.includes("detached frame") ||
      text.includes("execution context was destroyed") ||
      text.includes("cannot find context") ||
      text.includes("target closed") ||
      text.includes("session closed") ||
      text.includes("most likely because of a navigation")
    );
  }

  private _resetBrowserState(reason: string): void {
    logWarn(`[AgentRunner] Resetting browser automation state: ${reason}`);
    this._browserPage = null;
    this._snapshotRefMap = null;
    if (this._browser) {
      try {
        this._browser.close();
      } catch {
        // Ignore cleanup failures; we'll reconnect on demand.
      }
    }
    this._browser = null;
  }

  private async _isBrowserPageUsable(page: Page): Promise<boolean> {
    if (page.isClosed()) {
      return false;
    }
    try {
      // Probe frame liveness — page.title() will throw if the frame is detached
      await page.title();
      return true;
    } catch (error) {
      if (this._isRetryableBrowserPageError(error)) {
        logWarn(
          `[AgentRunner] Cached browser page became stale: ${toErrorText(error)}`,
        );
        return false;
      }
      throw error;
    }
  }

  private async _withBrowserPage<T>(
    operation: string,
    action: (page: Page) => Promise<T>,
  ): Promise<T> {
    try {
      const page = await this._getOrCreateBrowserPage();
      return await action(page);
    } catch (error) {
      if (!this._isRetryableBrowserPageError(error)) {
        throw error;
      }
      logWarn(
        `[AgentRunner] ${operation} hit stale browser state; retrying once: ${toErrorText(error)}`,
      );
      this._resetBrowserState(`${operation} retry`);
      const page = await this._getOrCreateBrowserPage();
      return await action(page);
    }
  }

  private async _getOrCreateBrowserPage(): Promise<Page> {
    this._browserViewManager?.show();

    if (
      this._browserPage &&
      (await this._isBrowserPageUsable(this._browserPage))
    ) {
      return this._browserPage;
    }
    this._browserPage = null;

    const { chromium } = await import("playwright-core");

    if (!this._browser || !this._browser.isConnected()) {
      this._browser = await chromium.connectOverCDP(
        `http://127.0.0.1:${BROWSER_CDP_PORT}`,
      );
      this._browser.on("disconnected", () => {
        this._browserPage = null;
        this._browser = null;
      });
    }

    const bvm = this._browserViewManager;
    const appUrl = bvm?.getAppWindowUrl() ?? "";
    const pages = this._browser.contexts()[0]?.pages() ?? [];
    const internalPages = pages.filter((p) => {
      const u = p.url();
      if (appUrl && (u === appUrl || u.startsWith(appUrl + "/"))) return false;
      if (u.startsWith("devtools://")) return false;
      if (u.startsWith("chrome-extension://")) return false;
      return true;
    });

    if (internalPages.length === 0) {
      throw new Error(
        "No internal browser page found via CDP. Is the browser panel open?",
      );
    }

    this._browserPage = internalPages[0];
    return this._browserPage;
  }

  // ---- unified locator resolution ----

  /**
   * Resolve a user-supplied selector to a Playwright Locator.
   * Supports: @eN snapshot refs, CSS selectors, visible text.
   */
  private _resolveLocator(page: Page, selector: string): Locator {
    const refMatch = /^@e(\d+)$/.exec(selector);
    if (refMatch && this._snapshotRefMap) {
      const info = this._snapshotRefMap.get(selector);
      if (info) {
        const { role, name, placeholder } = info;
        if (role === "textbox" || role === "searchbox") {
          if (placeholder) return page.getByPlaceholder(placeholder);
          if (name) return page.getByRole(role as "textbox" | "searchbox", { name });
        }
        if (role === "button") return page.getByRole("button", { name: name || "" });
        if (role === "link") return page.getByRole("link", { name: name || "" });
        if (role === "checkbox") return page.getByRole("checkbox", { name: name || "" });
        if (role === "radio") return page.getByRole("radio", { name: name || "" });
        if (role === "combobox" || role === "listbox")
          return page.getByRole(role as "combobox" | "listbox", { name: name || "" });
        if (name) return page.getByRole(role as "button", { name });
      }
      throw new Error(`Snapshot ref "${selector}" not found in current snapshot. Run internal_browser_snapshot first.`);
    }
    return page.locator(selector);
  }

  private _invalidateSnapshotRefs(): void {
    this._snapshotRefMap = null;
  }

  // ---- internal browser tools ----

  /** Build Playwright-powered browser automation tools. */
  private buildInternalBrowserTools(): ToolDefinition[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const td = (t: any): any => t;
    const bvm = this._browserViewManager;
    if (!bvm) return [];

    const self = this;

    const withPage = <T,>(
      operation: string,
      action: (page: Page) => Promise<T>,
    ) => self._withBrowserPage(operation, action);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // The "name" shown in snapshot output is the accessible name (derived from
    // label / aria-label / text content), NOT the HTML name attribute. When
    // writing CSS selectors, inspect the real DOM or use @eN refs for targeting.
    function flattenA11y(axNodes: Record<string, any>[]): string[] {
      const lines: string[] = [];
      const refMap = new Map<string, { role: string; name?: string; placeholder?: string; value?: string }>();
      let refIndex = 0;
      const interactiveRoles = new Set([
        "button", "link", "textbox", "searchbox", "combobox", "listbox",
        "checkbox", "radio", "switch", "tab", "menuitem", "option",
        "slider", "spinbutton", "heading", "listitem",
      ]);
      const nodeMap = new Map<string, typeof axNodes[0]>();
      for (const n of axNodes) {
        nodeMap.set(n.nodeId, n);
      }
      // Find root nodes: nodes whose nodeId is not referenced as childId by any other node
      const childIdSet = new Set(axNodes.flatMap((n) => n.childIds ?? []));
      const rootNodes = axNodes.filter((n) => !n.ignored && !childIdSet.has(n.nodeId));
      const starts = rootNodes.length > 0 ? rootNodes : axNodes.filter((n) => !n.ignored);
      function walk(node: typeof axNodes[0], depth: number) {
        if (node.ignored) {
          // Still walk children — ignored wrapper may contain interactive nodes
          for (const cid of node.childIds ?? []) {
            const child = nodeMap.get(cid);
            if (child) walk(child, depth);
          }
          return;
        }
        const role = node.role?.value?.toLowerCase() ?? "";
        if (interactiveRoles.has(role)) {
          refIndex++;
          const ref = `@e${refIndex}`;
          const indent = "  ".repeat(depth);
          const parts: string[] = [`${indent}${ref} [${role}`];
          const name = node.name?.value;
          if (name) parts.push(`name="${name}"`);
          const props = node.properties ?? [];
          const getProp = (pn: string) => props.find((p: { name: string; value?: { value?: unknown } }) => p.name === pn)?.value?.value;
          const val = getProp("valuetext") ?? getProp("value");
          if (val !== undefined && val !== "") parts.push(`value="${val}"`);
          const checked = getProp("checked");
          if (checked === "mixed" || checked === "true") parts.push("checked");
          if (getProp("disabled") === "true") parts.push("disabled");
          const placeholder = getProp("placeholder");
          if (placeholder) parts.push(`placeholder="${placeholder}"`);
          lines.push(`${parts.join(" ")}]`);
          refMap.set(ref, {
            role,
            name: name || undefined,
            placeholder: placeholder || undefined,
            value: val || undefined,
          });
        }
        for (const cid of node.childIds ?? []) {
          const child = nodeMap.get(cid);
          if (child) walk(child, depth + (interactiveRoles.has(role) ? 1 : 0));
        }
      }
      for (const root of starts) walk(root, 0);
      self._snapshotRefMap = refMap;
      return lines;
    }

    // ---- tools ----

    const navigate = {
      name: "internal_browser_navigate",
      label: "Navigate page",
      description: "Navigate the current internal browser page to a URL.",
      parameters: Type.Object({
        url: Type.String({ description: "URL to navigate to" }),
      }),
      async execute(_tcId: any, params: any, _signal: any, _onUpd: any, _ctx: any) {
        const { url } = params as { url: string };
        self._invalidateSnapshotRefs();
        return withPage("internal_browser_navigate", async (page) => {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
          return { content: [{ type: "text" as const, text: `Navigated to ${page.url()}` }] };
        });
      },
    };

    const screenshot = {
      name: "internal_browser_screenshot",
      label: "Take screenshot",
      description: "Take a screenshot of the current internal browser page.",
      parameters: Type.Object({
        fullPage: Type.Optional(Type.Boolean({ description: "Capture full scrollable page" })),
      }),
      async execute(_tcId: any, params: any, _signal: any, _onUpd: any, _ctx: any) {
        const { fullPage } = params as { fullPage?: boolean };
        return withPage("internal_browser_screenshot", async (page) => {
          const buf = (await page.screenshot({ fullPage: fullPage ?? false, type: "png" })) as Buffer;
          const base64 = buf.toString("base64");
          return {
            content: [{ type: "text" as const, text: `Screenshot captured (${(buf.length / 1024).toFixed(1)} KB)` }],
            details: { openCoworkImages: [{ data: base64, mimeType: "image/png" }] },
          };
        });
      },
    };

    const clickTool = {
      name: "internal_browser_click",
      label: "Click element",
      description: "Click an element on the page by CSS selector, @eN snapshot ref, or text content.",
      parameters: Type.Object({
        selector: Type.String({ description: "CSS selector, @eN snapshot ref, or visible text to click" }),
      }),
      async execute(_tcId: any, params: any, _signal: any, _onUpd: any, _ctx: any) {
        const { selector } = params as { selector: string };
        return withPage("internal_browser_click", async (page) => {
          await self._resolveLocator(page, selector).click({ timeout: 5000 });
          return { content: [{ type: "text" as const, text: `Clicked "${selector}"` }] };
        });
      },
    };

    const fillTool = {
      name: "internal_browser_fill",
      label: "Fill input",
      description: "Fill a form field. Clears any existing content then types the text. Works with <input>, <textarea>, <select>, and contenteditable elements.",
      parameters: Type.Object({
        selector: Type.String({ description: "CSS selector or @eN ref of the input element" }),
        text: Type.String({ description: "Text to fill" }),
      }),
      async execute(_tcId: any, params: any, _signal: any, _onUpd: any, _ctx: any) {
        const { selector, text } = params as { selector: string; text: string };
        return withPage("internal_browser_fill", async (page) => {
          // Use force:true to skip Playwright's actionability checks.
          // On complex pages (e.g. Baidu), locator.fill() often fails with
          // "not clickable" / "element is not visible" even though the input
          // is perfectly functional. force:true types directly into the element
          // while still dispatching all necessary DOM events (focus, input, change).
          try {
            await self._resolveLocator(page, selector).fill(text, { timeout: 5000, force: true });
          } catch (forceErr) {
            if (self._isRetryableBrowserPageError(forceErr)) {
              throw forceErr; // Stale page — let _withBrowserPage retry
            }
            // force:true also failed — fall back to raw DOM manipulation
            logWarn(`[AgentRunner] fill force:true failed, trying DOM fallback: ${toErrorText(forceErr)}`);
            try {
              await page.evaluate(({ sel, txt }: { sel: string; txt: string }) => {
                let el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
                if (!el) {
                  // Fuzzy fallback: try to extract name= from a CSS attribute selector
                  const m = sel.match(/\[name=["']([^"']*)["']\]/);
                  if (m) {
                    const all = document.querySelectorAll('input, textarea, select');
                    el = (Array.from(all).find(
                      (e) => e.getAttribute('name') === m[1],
                    ) ?? null) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
                  }
                }
                if (!el || !("value" in el)) throw new Error(`Cannot fill: ${sel}`);
                el.focus();
                el.value = txt;
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
              }, { sel: selector, txt: text });
            } catch (domErr) {
              logWarn(`[AgentRunner] fill DOM fallback also failed: ${toErrorText(domErr)}`);
              throw forceErr; // Re-throw the force:true error
            }
          }
          return { content: [{ type: "text" as const, text: `Filled "${text}" into "${selector}"` }] };
        });
      },
    };

    const scrollTool = {
      name: "internal_browser_scroll",
      label: "Scroll page",
      description: "Scroll the page by pixel deltas. Positive dy scrolls down, positive dx scrolls right.",
      parameters: Type.Object({
        dx: Type.Optional(Type.Number({ description: "Horizontal delta (default 0)" })),
        dy: Type.Optional(Type.Number({ description: "Vertical delta (default 0)" })),
      }),
      async execute(_tcId: any, params: any, _signal: any, _onUpd: any, _ctx: any) {
        const { dx, dy } = params as { dx?: number; dy?: number };
        return withPage("internal_browser_scroll", async (page) => {
          await page.evaluate(({ x, y }) => window.scrollBy(x ?? 0, y ?? 0), { x: dx ?? 0, y: dy ?? 0 });
          return { content: [{ type: "text" as const, text: `Scrolled by (${dx ?? 0}, ${dy ?? 0})` }] };
        });
      },
    };

    const hoverTool = {
      name: "internal_browser_hover",
      label: "Hover element",
      description: "Hover the mouse over an element.",
      parameters: Type.Object({
        selector: Type.String({ description: "CSS selector or @eN ref of the element to hover" }),
      }),
      async execute(_tcId: any, params: any, _signal: any, _onUpd: any, _ctx: any) {
        const { selector } = params as { selector: string };
        return withPage("internal_browser_hover", async (page) => {
          await self._resolveLocator(page, selector).hover({ timeout: 5000 });
          return { content: [{ type: "text" as const, text: `Hovered "${selector}"` }] };
        });
      },
    };

    const selectTool = {
      name: "internal_browser_select",
      label: "Select option",
      description: "Select an option from a <select> dropdown by value or label.",
      parameters: Type.Object({
        selector: Type.String({ description: "CSS selector or @eN ref of the <select> element" }),
        value: Type.String({ description: "Option value or label to select" }),
      }),
      async execute(_tcId: any, params: any, _signal: any, _onUpd: any, _ctx: any) {
        const { selector, value } = params as { selector: string; value: string };
        return withPage("internal_browser_select", async (page) => {
          try {
            await self._resolveLocator(page, selector).selectOption(value, { timeout: 5000 });
          } catch (err) {
            if (!self._isRetryableBrowserPageError(err)) {
              // DOM fallback for custom select widgets (Bootstrap, React, etc.)
              // that don't respond to native selectOption()
              logWarn(`[AgentRunner] select locator failed, trying DOM fallback: ${toErrorText(err)}`);
              try {
                await page.evaluate(({ sel, val }: { sel: string; val: string }) => {
                  const el = document.querySelector(sel) as HTMLSelectElement | null;
                  if (!el || el.tagName !== "SELECT") throw new Error(`Not a <select>: ${sel}`);
                  // Match by option value first, then by label text (exact, trimmed).
                  // Playwright's selectOption(label) can match imprecisely when
                  // multiple options share substrings.
                  const options = Array.from(el.options);
                  let target = options.find((o) => o.value === val);
                  if (!target) target = options.find((o) => o.text.trim() === val.trim());
                  if (target) {
                    el.value = target.value;
                    el.dispatchEvent(new Event("input", { bubbles: true }));
                    el.dispatchEvent(new Event("change", { bubbles: true }));
                  } else {
                    throw new Error(`Option "${val}" not found in <select> ${sel} (checked by value and label)`);
                  }
                }, { sel: selector, val: value });
              } catch (domErr) {
                logWarn(`[AgentRunner] select DOM fallback also failed: ${toErrorText(domErr)}`);
                throw err;
              }
            } else {
              throw err;
            }
          }
          return { content: [{ type: "text" as const, text: `Selected "${value}" in "${selector}"` }] };
        });
      },
    };

    const pressTool = {
      name: "internal_browser_press",
      label: "Press key",
      description: "Press a keyboard key. Use for Enter, Escape, Tab, Backspace, arrow keys, or combos like Control+A.",
      parameters: Type.Object({
        key: Type.String({ description: "Key to press (e.g. Enter, Escape, Tab, ArrowDown, Control+A)" }),
      }),
      async execute(_tcId: any, params: any, _signal: any, _onUpd: any, _ctx: any) {
        const { key } = params as { key: string };
        return withPage("internal_browser_press", async (page) => {
          await page.keyboard.press(key as Parameters<typeof page.keyboard.press>[0]);
          return { content: [{ type: "text" as const, text: `Pressed "${key}"` }] };
        });
      },
    };

    const snapshotTool = {
      name: "internal_browser_snapshot",
      label: "Take text snapshot",
      description: "Capture an accessibility text snapshot of the current page. Returns interactive elements as @eN [role] references. @eN refs can be used in subsequent click, fill, hover, and select calls within the same page. Note: the 'name' shown is the accessible name (derived from label/aria-label/text), not the HTML name attribute.",
      parameters: Type.Object({}),
      async execute(_tcId: any, _params: any, _signal: any, _onUpd: any, _ctx: any) {
        return withPage("internal_browser_snapshot", async (page) => {
          const cdp = await page.context().newCDPSession(page);
          try {
            await cdp.send("Accessibility.enable");
            const { nodes } = await cdp.send("Accessibility.getFullAXTree");
            const lines = flattenA11y(nodes);
            const text = lines.length > 0 ? lines.join("\n").substring(0, 15000) : "(no interactive elements found)";
            return { content: [{ type: "text" as const, text }] };
          } finally {
            await cdp.detach().catch(() => {});
          }
        });
      },
    };

    const evaluateTool = {
      name: "internal_browser_evaluate",
      label: "Evaluate JavaScript",
      description: "Execute JavaScript in the context of the current page.",
      parameters: Type.Object({
        script: Type.String({ description: "JavaScript code to execute" }),
      }),
      async execute(_tcId: any, params: any, _signal: any, _onUpd: any, _ctx: any) {
        const { script } = params as { script: string };
        return withPage("internal_browser_evaluate", async (page) => {
          const result = await page.evaluate(script);
          return { content: [{ type: "text" as const, text: typeof result === "string" ? result : JSON.stringify(result) }] };
        });
      },
    };

    const waitForTool = {
      name: "internal_browser_wait_for",
      label: "Wait for element",
      description: "Wait for text, a CSS selector, network idle, or a URL pattern.",
      parameters: Type.Object({
        text: Type.Optional(Type.String({ description: "Text to wait for" })),
        selector: Type.Optional(Type.String({ description: "CSS selector to wait for" })),
        timeout: Type.Optional(Type.Integer({ description: "Max wait time in ms (default 10000)" })),
        state: Type.Optional(Type.String({ description: "Wait state: 'networkidle' or 'load'" })),
        url: Type.Optional(Type.String({ description: "URL glob pattern to wait for (e.g. **/dashboard). Note: triggers only on navigation; the current URL is checked first — if it already matches the wait returns immediately." })),
      }),
      async execute(_tcId: any, params: any, _signal: any, _onUpd: any, _ctx: any) {
        const { text, selector, timeout, state, url } = params as {
          text?: string; selector?: string; timeout?: number; state?: string; url?: string;
        };
        return withPage("internal_browser_wait_for", async (page) => {
          const ms = timeout ?? 10000;
          if (state === "networkidle") {
            await page.waitForLoadState("networkidle", { timeout: ms });
          } else if (state === "load") {
            await page.waitForLoadState("load", { timeout: ms });
          } else if (url) {
            const urlRe = new RegExp("^" + url.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$");
            if (!urlRe.test(page.url())) {
              await page.waitForURL((u) => urlRe.test(u.toString()), { timeout: ms });
            }
          } else if (selector) {
            await page.locator(selector).waitFor({ timeout: ms });
          } else if (text) {
            await page.getByText(text).first().waitFor({ timeout: ms });
          }
          const what = url ? `URL pattern "${url}"` : state ? `state "${state}"` : (selector ? `selector "${selector}"` : `text "${text}"`);
          return { content: [{ type: "text" as const, text: `Wait satisfied for ${what}` }] };
        });
      },
    };

    const getStateTool = {
      name: "internal_browser_get_state",
      label: "Get page state",
      description: "Get the current page URL and title.",
      parameters: Type.Object({}),
      async execute(_tcId: any, _params: any, _signal: any, _onUpd: any, _ctx: any) {
        return withPage("internal_browser_get_state", async (page) => {
          const [url, title] = await Promise.all([page.url(), page.title()]);
          return { content: [{ type: "text" as const, text: JSON.stringify({ url, title }) }] };
        });
      },
    };

    return [
      td(navigate),
      td(screenshot),
      td(clickTool),
      td(fillTool),
      td(scrollTool),
      td(hoverTool),
      td(selectTool),
      td(pressTool),
      td(snapshotTool),
      td(evaluateTool),
      td(waitForTool),
      td(getStateTool),
    ];
  }
  private buildWebTools(): ToolDefinition[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const td = (t: any): any => t;

    const webFetchTool = {
      name: "web_fetch",
      label: "Web Fetch",
      description:
        "Fetches a URL, extracts readable content using Firefox Reader View, and returns clean Markdown. Use for retrieving web page content.",
      parameters: Type.Object({
        url: Type.String({ description: "HTTP/HTTPS URL to fetch" }),
        max_chars: Type.Optional(
          Type.Number({
            description: "Maximum characters to return (default: 20000)",
          }),
        ),
      }),
      async execute(
        _toolCallId: any,
        params: any,
        _signal: any,
        _onUpdate: any,
        _ctx: any,
      ) {
        const { url, max_chars = 20000 } = params as {
          url: string;
          max_chars?: number;
        };

        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          throw new Error("Invalid URL");
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error("Only HTTP/HTTPS URLs are supported");
        }
        if (AgentRunner.isPrivateHost(parsed.hostname)) {
          throw new Error(
            `Cannot fetch private/internal host: ${parsed.hostname}`,
          );
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        let response: Response;
        try {
          response = await fetch(url, {
            signal: controller.signal,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
              "Accept-Language": "en-US,en;q=0.9",
              Accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
          });
        } finally {
          clearTimeout(timeout);
        }

        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status}: ${response.statusText}`,
          );
        }

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("text/html")) {
          throw new Error(
            `Unsupported content type: ${contentType}. Only text/html is supported.`,
          );
        }

        const contentLength = parseInt(
          response.headers.get("content-length") || "0",
        );
        const MAX_HTML_BYTES = 5 * 1024 * 1024; // 5 MB
        if (contentLength > MAX_HTML_BYTES) {
          throw new Error(
            `Page too large (${(contentLength / 1e6).toFixed(1)} MB). Max is 5 MB.`,
          );
        }

        const html = await response.text();

        let JSDOM: any, Readability: any, TurndownService: any;
        try {
          ({ JSDOM } = await import("jsdom"));
          ({ Readability } = await import("@mozilla/readability"));
          TurndownService = (await import("turndown")).default;
        } catch {
          throw new Error(
            "web_fetch dependencies (jsdom, readability, turndown) not available. " +
              "The app may need to be rebuilt.",
          );
        }

        const dom = new JSDOM(html, { url });
        const reader = new Readability(dom.window.document);
        const article = reader.parse();

        if (!article || !article.content) {
          throw new Error(
            "Could not extract readable content from the page",
          );
        }

        const turndown = new TurndownService({
          headingStyle: "atx",
          codeBlockStyle: "fenced",
        });
        let markdown = turndown.turndown(article.content);

        const title = article.title || dom.window.document.title || "";
        if (title) {
          markdown = `## ${title}\n\n${markdown}`;
        }

        if (markdown.length > max_chars) {
          markdown = markdown.slice(0, max_chars) + "...";
        }

        return {
          content: [{ type: "text" as const, text: markdown }],
        };
      },
    };

    return [td(webFetchTool)];
  }

  /**
   * Check if a command contains sudo
   */
  private static isSudoCommand(command: string): boolean {
    return /\bsudo\b/.test(command);
  }

  /**
   * Check if a hostname is a private/internal/loopback address.
   * Prevents SSRF via web_fetch against internal networks.
   */
  private static isPrivateHost(hostname: string): boolean {
    // Loopback
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "0.0.0.0"
    ) {
      return true;
    }
    // IPv4 private ranges: 10.x, 172.16-31.x, 192.168.x, 169.254.x
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(hostname)) {
      return true;
    }
    // Cloud metadata endpoints
    if (hostname === "metadata.google.internal") {
      return true;
    }
    return false;
  }

  /**
   * Wrap the bash tool in the coding tools array to intercept sudo commands.
   * When a sudo command is detected, prompts the user for a password,
   * then rewrites the command to pipe the password into sudo -S.
   */
  private wrapBashToolForSudo(
    tools: ToolDefinition[],
    sessionId: string,
    effectiveCwd: string,
  ): ToolDefinition[] {
    if (!this.requestSudoPassword) return tools;

    const requestSudoPassword = this.requestSudoPassword;

    return tools.map((tool) => {
      if (tool.name !== "bash") return tool;

      const originalExecute = tool.execute;
      return {
        ...tool,
        execute: async (
          toolCallId: string,
          params: { command: string; timeout?: number },
          signal: AbortSignal | undefined,
          onUpdate: ((update: unknown) => void) | undefined,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ctx: any,
        ) => {
          const command = params.command;

          if (AgentRunner.isSudoCommand(command)) {
            log("[AgentRunner] Sudo command detected, requesting password");
            const password = await requestSudoPassword(
              sessionId,
              toolCallId,
              command,
            );

            if (!password) {
              log("[AgentRunner] Sudo password cancelled by user");
              return {
                content: [
                  {
                    type: "text" as const,
                    text: "Command cancelled: user denied sudo password.",
                  },
                ],
                details: undefined as unknown,
              };
            }

            // Add -S flag to sudo invocations that don't already have it
            const rewrittenCommand = command.replace(
              /\bsudo\b(?!\s+-S)/g,
              "sudo -S",
            );

            // Pass password via stdin pipe so it never appears in process args
            // or environment variables. Uses async spawn with stdio: 'pipe'.
            log(
              "[AgentRunner] Executing sudo command with password injection (via stdin pipe)",
            );
            try {
              const shell =
                process.platform === "win32" ? "cmd.exe" : "/bin/sh";
              const shellArgs =
                process.platform === "win32"
                  ? ["/c", rewrittenCommand]
                  : ["-c", rewrittenCommand];
              const timeoutMs = (params.timeout ?? 120) * 1000;
              const output = await new Promise<string>((resolve, reject) => {
                const child = spawn(shell, shellArgs, {
                  stdio: ["pipe", "pipe", "pipe"],
                  cwd: effectiveCwd,
                });
                let stdout = "";
                let stderr = "";
                const timer = setTimeout(() => {
                  child.kill("SIGKILL");
                  reject(
                    new Error(`Sudo command timed out after ${timeoutMs}ms`),
                  );
                }, timeoutMs);
                child.stdout.on("data", (chunk: Buffer) => {
                  stdout += chunk.toString();
                });
                child.stderr.on("data", (chunk: Buffer) => {
                  stderr += chunk.toString();
                });
                child.on("error", (err) => {
                  clearTimeout(timer);
                  reject(err);
                });
                child.on("close", () => {
                  clearTimeout(timer);
                  resolve(stdout + stderr);
                });
                child.stdin.write(password + "\n");
                child.stdin.end();
              });
              return {
                content: [
                  { type: "text" as const, text: output || "(no output)" },
                ],
                details: undefined as unknown,
              };
            } catch (sudoErr) {
              logError("[AgentRunner] Sudo command failed:", sudoErr);
              throw sudoErr instanceof Error
                ? sudoErr
                : new Error(String(sudoErr));
            }
          }

          return originalExecute(toolCallId, params, signal, onUpdate, ctx);
        },
      } as ToolDefinition;
    });
  }

  /**
   * Wrap the bash tool to inject a default timeout when the model omits one.
   * The pi-coding-agent SDK's bash tool has no default timeout, which means
   * commands can run indefinitely if the model doesn't specify a timeout.
   */
  private static wrapBashToolWithDefaultTimeout(
    tools: ToolDefinition[],
  ): ToolDefinition[] {
    const DEFAULT_BASH_TIMEOUT_SECONDS = 120;

    return tools.map((tool) => {
      if (tool.name !== "bash") return tool;

      const originalExecute = tool.execute;
      return {
        ...tool,
        execute: async (
          toolCallId: string,
          params: { command: string; timeout?: number },
          signal: AbortSignal | undefined,
          onUpdate: ((update: unknown) => void) | undefined,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ctx: any,
        ) => {
          const effectiveParams =
            params.timeout != null
              ? params
              : { ...params, timeout: DEFAULT_BASH_TIMEOUT_SECONDS };
          return originalExecute(
            toolCallId,
            effectiveParams,
            signal,
            onUpdate,
            ctx,
          );
        },
      } as ToolDefinition;
    });
  }

  async run(
    session: Session,
    prompt: string,
    existingMessages: Message[],
    turnId?: string,
  ): Promise<void> {
    const runStartTime = Date.now();
    logCtx("[AgentRunner] run() started");

    const controller = new AbortController();
    try {
      // SDK 会在同一 AbortSignal 上挂载较多监听器，放开上限避免无意义告警干扰排错。
      setMaxListeners(0, controller.signal);
    } catch {
      // 旧运行时不支持 EventTarget 调整监听上限时忽略即可。
    }
    this.activeControllers.set(session.id, controller);

    // Sandbox isolation state (defined outside try for finally access)
    let sandboxPath: string | null = null;
    let useSandboxIsolation = false;

    // Helper to convert real sandbox paths back to virtual workspace paths in output
    // Cache the compiled regex to avoid recompilation on every call
    let sandboxPathRegex: RegExp | null = null;
    const sanitizeOutputPaths = (content: string): string => {
      if (!sandboxPath || !useSandboxIsolation) return content;
      if (!sandboxPathRegex) {
        sandboxPathRegex = new RegExp(
          sandboxPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "g",
        );
      }
      // Replace real sandbox path with virtual workspace path
      return content.replace(sandboxPathRegex, VIRTUAL_WORKSPACE_PATH);
    };

    const thinkingStepId = uuidv4();
    let abortedByTimeout = false;
    let turnCompletedNormally = false;

    try {
      this.pathResolver.registerSession(session.id, session.mountedPaths);
      logTiming("pathResolver.registerSession", runStartTime);

      // Note: User message is now added by the frontend immediately for better UX
      // No need to send it again from backend

      // Send initial thinking trace
      this.sendTraceStep(session.id, {
        id: thinkingStepId,
        type: "thinking",
        status: "running",
        title: "Processing request...",
        timestamp: Date.now(),
      });
      logTiming("sendTraceStep (thinking)", runStartTime);

      // Use session's cwd - each session has its own working directory
      const workingDir = session.cwd || undefined;
      logCtx("[AgentRunner] Working directory:", workingDir || "(none)");

      // Initialize sandbox sync if WSL mode is active
      const sandbox = getSandboxAdapter();

      if (sandbox.isWSL && sandbox.wslStatus?.distro && workingDir) {
        log("[AgentRunner] WSL mode active, initializing sandbox sync...");

        // Only show sync UI for new sessions (first message)
        const isNewSession = !SandboxSync.hasSession(session.id);

        if (isNewSession) {
          // Notify UI: syncing files (only for new sessions)
          this.sendToRenderer({
            type: "sandbox.sync",
            payload: {
              sessionId: session.id,
              phase: "syncing_files",
              message: "Syncing files to sandbox...",
              detail: "Copying project files to isolated WSL environment",
            },
          });
        }

        const syncResult = await SandboxSync.initSync(
          workingDir,
          session.id,
          sandbox.wslStatus.distro,
        );

        if (syncResult.success) {
          sandboxPath = syncResult.sandboxPath;
          useSandboxIsolation = true;
          log(`[AgentRunner] Sandbox initialized: ${sandboxPath}`);
          log(
            `[AgentRunner]   Files: ${syncResult.fileCount}, Size: ${syncResult.totalSize} bytes`,
          );

          if (isNewSession) {
            // Update UI with file count (only for new sessions)
            this.sendToRenderer({
              type: "sandbox.sync",
              payload: {
                sessionId: session.id,
                phase: "syncing_skills",
                message: "Configuring skills...",
                detail: "Copying built-in skills to sandbox",
                fileCount: syncResult.fileCount,
                totalSize: syncResult.totalSize,
              },
            });
          }

          // Copy skills to sandbox ~/.deskwand/skills/
          const builtinSkillsPath = this.getBuiltinSkillsPath();
          try {
            const distro = sandbox.wslStatus!.distro!;
            const sandboxSkillsPath = `${sandboxPath}/.deskwand/skills`;

            // Create .deskwand/skills directory in sandbox
            execFileSync(
              "wsl",
              ["-d", distro, "-e", "mkdir", "-p", sandboxSkillsPath],
              {
                encoding: "utf-8",
                timeout: 10000,
              },
            );

            if (builtinSkillsPath && fs.existsSync(builtinSkillsPath)) {
              // Use rsync via execFileSync with array args to avoid shell injection
              const wslSourcePath = pathConverter.toWSL(builtinSkillsPath);
              log(
                `[AgentRunner] Copying skills with rsync: ${wslSourcePath}/ -> ${sandboxSkillsPath}/`,
              );

              execFileSync(
                "wsl",
                [
                  "-d",
                  distro,
                  "-e",
                  "rsync",
                  "-av",
                  wslSourcePath + "/",
                  sandboxSkillsPath + "/",
                ],
                {
                  encoding: "utf-8",
                  timeout: 120000, // 2 min timeout for large skill directories
                },
              );
            }

            const appSkillsDir = this.getRuntimeSkillsDir();
            if (!fs.existsSync(appSkillsDir)) {
              fs.mkdirSync(appSkillsDir, { recursive: true });
            }
            this.syncUserSkillsToAppDir(appSkillsDir);

            if (fs.existsSync(appSkillsDir)) {
              const wslSourcePath = pathConverter.toWSL(appSkillsDir);
              log(
                `[AgentRunner] Copying app skills with rsync: ${wslSourcePath}/ -> ${sandboxSkillsPath}/`,
              );

              execFileSync(
                "wsl",
                [
                  "-d",
                  distro,
                  "-e",
                  "rsync",
                  "-avL",
                  wslSourcePath + "/",
                  sandboxSkillsPath + "/",
                ],
                {
                  encoding: "utf-8",
                  timeout: 120000, // 2 min timeout for large skill directories
                },
              );
            }

            // List copied skills for verification
            const copiedSkills = execFileSync(
              "wsl",
              ["-d", distro, "-e", "ls", sandboxSkillsPath],
              {
                encoding: "utf-8",
                timeout: 10000,
              },
            )
              .trim()
              .split(/\r?\n/)
              .filter(Boolean);

            log(`[AgentRunner] Skills copied to sandbox: ${sandboxSkillsPath}`);
            log(`[AgentRunner]   Skills: ${copiedSkills.join(", ")}`);
          } catch (error) {
            logError("[AgentRunner] Failed to copy skills to sandbox:", error);
          }

          if (isNewSession) {
            // Notify UI: sync complete (only for new sessions)
            this.sendToRenderer({
              type: "sandbox.sync",
              payload: {
                sessionId: session.id,
                phase: "ready",
                message: "Sandbox ready",
                detail: `Synced ${syncResult.fileCount} files`,
                fileCount: syncResult.fileCount,
                totalSize: syncResult.totalSize,
              },
            });
          }
        } else {
          logError("[AgentRunner] Sandbox sync failed:", syncResult.error);
          log("[AgentRunner] Falling back to /mnt/ access (less secure)");

          if (isNewSession) {
            // Notify UI: error (only for new sessions)
            this.sendToRenderer({
              type: "sandbox.sync",
              payload: {
                sessionId: session.id,
                phase: "error",
                message:
                  "Sandbox file sync failed, falling back to direct access mode",
                detail: "Falling back to direct access mode (less secure)",
              },
            });
          }
        }
      }

      // Initialize sandbox sync if Lima mode is active
      if (sandbox.isLima && sandbox.limaStatus?.instanceRunning && workingDir) {
        log("[AgentRunner] Lima mode active, initializing sandbox sync...");

        const { LimaSync } = await import("../sandbox/lima-sync");

        // Only show sync UI for new sessions (first message)
        const isNewLimaSession = !LimaSync.hasSession(session.id);

        if (isNewLimaSession) {
          // Notify UI: syncing files (only for new sessions)
          this.sendToRenderer({
            type: "sandbox.sync",
            payload: {
              sessionId: session.id,
              phase: "syncing_files",
              message: "Syncing files to sandbox...",
              detail: "Copying project files to isolated Lima environment",
            },
          });
        }

        const syncResult = await LimaSync.initSync(workingDir, session.id);

        if (syncResult.success) {
          sandboxPath = syncResult.sandboxPath;
          useSandboxIsolation = true;
          log(`[AgentRunner] Sandbox initialized: ${sandboxPath}`);
          log(
            `[AgentRunner]   Files: ${syncResult.fileCount}, Size: ${syncResult.totalSize} bytes`,
          );

          if (isNewLimaSession) {
            // Update UI with file count (only for new sessions)
            this.sendToRenderer({
              type: "sandbox.sync",
              payload: {
                sessionId: session.id,
                phase: "syncing_skills",
                message: "Configuring skills...",
                detail: "Copying built-in skills to sandbox",
                fileCount: syncResult.fileCount,
                totalSize: syncResult.totalSize,
              },
            });
          }

          // Copy skills to sandbox ~/.deskwand/skills/
          const builtinSkillsPath = this.getBuiltinSkillsPath();
          try {
            const sandboxSkillsPath = `${sandboxPath}/.deskwand/skills`;

            // Create .deskwand/skills directory in sandbox
            execFileSync(
              "limactl",
              [
                "shell",
                "deskwand-sandbox",
                "--",
                "mkdir",
                "-p",
                sandboxSkillsPath,
              ],
              {
                encoding: "utf-8",
                timeout: 10000,
              },
            );

            if (builtinSkillsPath && fs.existsSync(builtinSkillsPath)) {
              // Use rsync via execFileSync with array args to avoid shell injection
              // Lima mounts /Users directly, so paths are the same
              log(
                `[AgentRunner] Copying skills with rsync: ${builtinSkillsPath}/ -> ${sandboxSkillsPath}/`,
              );

              execFileSync(
                "limactl",
                [
                  "shell",
                  "deskwand-sandbox",
                  "--",
                  "rsync",
                  "-av",
                  builtinSkillsPath + "/",
                  sandboxSkillsPath + "/",
                ],
                {
                  encoding: "utf-8",
                  timeout: 120000, // 2 min timeout for large skill directories
                },
              );
            }

            const appSkillsDir = this.getRuntimeSkillsDir();
            if (!fs.existsSync(appSkillsDir)) {
              fs.mkdirSync(appSkillsDir, { recursive: true });
            }
            this.syncUserSkillsToAppDir(appSkillsDir);

            if (fs.existsSync(appSkillsDir)) {
              log(
                `[AgentRunner] Copying app skills with rsync: ${appSkillsDir}/ -> ${sandboxSkillsPath}/`,
              );

              execFileSync(
                "limactl",
                [
                  "shell",
                  "deskwand-sandbox",
                  "--",
                  "rsync",
                  "-avL",
                  appSkillsDir + "/",
                  sandboxSkillsPath + "/",
                ],
                {
                  encoding: "utf-8",
                  timeout: 120000, // 2 min timeout for large skill directories
                },
              );
            }

            // List copied skills for verification
            const copiedSkills = execFileSync(
              "limactl",
              ["shell", "deskwand-sandbox", "--", "ls", sandboxSkillsPath],
              {
                encoding: "utf-8",
                timeout: 10000,
              },
            )
              .trim()
              .split(/\r?\n/)
              .filter(Boolean);

            log(`[AgentRunner] Skills copied to sandbox: ${sandboxSkillsPath}`);
            log(`[AgentRunner]   Skills: ${copiedSkills.join(", ")}`);
          } catch (error) {
            logError("[AgentRunner] Failed to copy skills to sandbox:", error);
          }

          if (isNewLimaSession) {
            // Notify UI: sync complete (only for new sessions)
            this.sendToRenderer({
              type: "sandbox.sync",
              payload: {
                sessionId: session.id,
                phase: "ready",
                message: "Sandbox ready",
                detail: `Synced ${syncResult.fileCount} files`,
                fileCount: syncResult.fileCount,
                totalSize: syncResult.totalSize,
              },
            });
          }
        } else {
          logError("[AgentRunner] Sandbox sync failed:", syncResult.error);
          log("[AgentRunner] Falling back to direct access (less secure)");

          if (isNewLimaSession) {
            // Notify UI: error (only for new sessions)
            this.sendToRenderer({
              type: "sandbox.sync",
              payload: {
                sessionId: session.id,
                phase: "error",
                message:
                  "Sandbox file sync failed, falling back to direct access mode",
                detail: "Falling back to direct access mode (less secure)",
              },
            });
          }
        }
      }

      // Check if current user message includes images
      const lastUserMessage =
        existingMessages.length > 0
          ? existingMessages[existingMessages.length - 1]
          : null;

      logCtx("[AgentRunner] Total messages:", existingMessages.length);

      const hasImages =
        lastUserMessage?.content.some(
          (c) => (c as { type?: string }).type === "image",
        ) || false;
      if (hasImages) {
        log("[AgentRunner] User message contains images");
      }

      logTiming("before pi-ai model resolution", runStartTime);

      const resolvedRuntime = await modelResolutionService.resolve({
        sessionProviderProfileKey: session.providerProfileKey,
        sessionModel: session.model,
        appConfig: configStore.getAll(),
      });
      const runtimeConfig = {
        provider: resolvedRuntime.providerType,
        customProtocol: resolvedRuntime.customProtocol,
        apiKey: resolvedRuntime.apiKey,
        baseUrl: resolvedRuntime.baseUrl,
        model: resolvedRuntime.modelId,
        contextWindow: resolvedRuntime.contextWindow,
        maxTokens: resolvedRuntime.maxTokens,
      };
      const provider = resolvedRuntime.providerType || "anthropic";
      let piModel = resolvedRuntime.piModel;

      logCtx(
        "[AgentRunner] Model resolution trace:",
        JSON.stringify(resolvedRuntime.trace),
      );
      if (resolvedRuntime.trace.piModelSource === "synthetic") {
        logCtxWarn(
          "[AgentRunner] Model not in pi-ai registry, using synthetic model:",
          resolvedRuntime.modelId,
          "→",
          piModel.api,
        );
      }
      logCtx(
        "[AgentRunner] Resolved pi-ai model:",
        piModel.provider,
        piModel.id,
      );

      // Send context window info to renderer for UI display
      this.sendToRenderer({
        type: "session.contextInfo",
        payload: {
          sessionId: session.id,
          contextWindow: piModel.contextWindow || 128000,
        },
      });

      // Set up API keys via AuthStorage
      const authStorage = getSharedAuthStorage();
      const apiKey = runtimeConfig.apiKey?.trim();
      if (apiKey) {
        // Map our config provider to pi-ai provider name
        const piProvider =
          provider === "custom"
            ? runtimeConfig.customProtocol || "anthropic"
            : provider;
        authStorage.setRuntimeApiKey(piProvider, apiKey);
        // Also set the key for the model's native provider (e.g., when using
        // google/gemini via openrouter, pi-ai looks up "google" not "openrouter")
        if (piModel.provider !== piProvider) {
          authStorage.setRuntimeApiKey(piModel.provider, apiKey);
          log(
            "[AgentRunner] Set runtime API key for model provider:",
            piModel.provider,
          );
        }
        log(
          "[AgentRunner] Set runtime API key for config provider:",
          piProvider,
        );
      } else {
        if (provider === "ollama") {
          log(
            "[AgentRunner] Ollama configured without explicit API key; relying on OpenAI-compatible placeholder/env auth path",
            safeStringify({
              provider,
              modelProvider: piModel.provider,
              modelId: piModel.id,
              baseUrl: piModel.baseUrl || runtimeConfig.baseUrl || "",
            }),
          );
        } else {
          logWarn(
            "[AgentRunner] No API key configured for provider:",
            provider,
          );
        }
      }

      // baseUrl is now embedded in the model object via resolvePiModel()
      logCtx(
        "[AgentRunner] Model baseUrl:",
        piModel.baseUrl,
        "api:",
        piModel.api,
      );

      logTiming("after pi-ai model resolution", runStartTime);

      // pi-coding-agent handles path sandboxing via its own tools
      const imageCapable = true; // pi-ai models generally support images; let the model handle unsupported cases
      // session.cwd is always set (createSession), so workingDir is always
      // a valid path; fall back to userData as a safe default instead of
      // process.cwd() which can be '/' in packaged macOS builds.
      const effectiveCwd =
        useSandboxIsolation && sandboxPath
          ? sandboxPath
          : workingDir || app.getPath("userData");

      // Use app-specific DeskWand config directory to avoid conflicts with user settings
      // SDK uses DeskWand_CONFIG_DIR to locate skills
      const userDeskWandDir = this.getAppDeskWandDir();

      // Skills directory setup: only run on the first query per runner instance.
      // Symlinks and directories are stable across queries; re-running every time
      // wastes ~10-30 syscalls per query for no benefit. Call invalidateSkillsSetup()
      // to force a re-run after the user installs or removes a skill.
      if (!this._skillsSetupDone && !this._skillsSetupInProgress) {
        this._skillsSetupInProgress = true;
        try {
        // Ensure app DeskWand config directory exists
        if (!fs.existsSync(userDeskWandDir)) {
          fs.mkdirSync(userDeskWandDir, { recursive: true });
        }

        // Ensure app DeskWand skills directory exists
        const appSkillsDir = this.getRuntimeSkillsDir();
        if (!fs.existsSync(appSkillsDir)) {
          fs.mkdirSync(appSkillsDir, { recursive: true });
        }

        // Copy built-in skills to app DeskWand skills directory if they don't exist
        const builtinSkillsPath = this.getBuiltinSkillsPath();
        if (builtinSkillsPath && fs.existsSync(builtinSkillsPath)) {
          // Symlinks into .asar archives don't work at the OS level (ENOTDIR),
          // so always copy when the source is inside an asar archive.
          // Use regex to match .asar/ but NOT .asar.unpacked/ (which is a real directory).
          const sourceInsideAsar = /\.asar[/\\]/.test(builtinSkillsPath);
          const builtinSkills = fs.readdirSync(builtinSkillsPath);
          for (const skillName of builtinSkills) {
            const builtinSkillPath = path.join(builtinSkillsPath, skillName);
            const userSkillPath = path.join(appSkillsDir, skillName);

            // Clean up broken symlinks pointing into .asar from previous versions
            try {
              const lstat = fs.lstatSync(userSkillPath);
              if (lstat.isSymbolicLink()) {
                const linkTarget = fs.readlinkSync(userSkillPath);
                if (/\.asar[/\\]/.test(linkTarget)) {
                  fs.unlinkSync(userSkillPath);
                  log(
                    `[AgentRunner] Removed broken asar symlink: ${userSkillPath}`,
                  );
                }
              }
            } catch {
              // Path doesn't exist — fine, we'll create it below
            }

            // Only set up if it's a directory and doesn't exist in app directory
            if (
              fs.statSync(builtinSkillPath).isDirectory() &&
              !fs.existsSync(userSkillPath)
            ) {
              try {
                if (sourceInsideAsar) {
                  // Source is inside .asar — must copy (symlinks to asar paths fail at OS level)
                  this.copyDirectorySync(builtinSkillPath, userSkillPath);
                  log(
                    `[AgentRunner] Copied built-in skill from asar: ${skillName}`,
                  );
                } else {
                  // Source is a real directory — symlink for space efficiency
                  try {
                    fs.symlinkSync(builtinSkillPath, userSkillPath, "dir");
                    log(`[AgentRunner] Linked built-in skill: ${skillName}`);
                  } catch (symErr) {
                    logWarn(
                      `[AgentRunner] Failed to symlink ${skillName}, copying instead:`,
                      (symErr as NodeJS.ErrnoException).code,
                    );
                    // Ensure the target path is clear before copying
                    try {
                      const lst = fs.lstatSync(userSkillPath);
                      if (lst.isDirectory()) {
                        fs.rmSync(userSkillPath, { recursive: true, force: true });
                      } else {
                        fs.unlinkSync(userSkillPath);
                      }
                    } catch {
                      // Target did not exist or was already gone
                    }
                    this.copyDirectorySync(builtinSkillPath, userSkillPath);
                  }
                }
              } catch (skillErr) {
                logWarn(
                  `[AgentRunner] Failed to set up built-in skill ${skillName}:`,
                  (skillErr as NodeJS.ErrnoException).code,
                );
                // Clean up partial target to allow retry on next start
                try {
                  fs.rmSync(userSkillPath, { recursive: true, force: true });
                } catch {
                  // best-effort cleanup
                }
              }
            }
          }
        }

        this.syncUserSkillsToAppDir(appSkillsDir);

        // Only mark setup done after successful completion — if we failed,
        // the next query will retry.
        this._skillsSetupDone = true;
        log("[AgentRunner] Skills setup complete");
        } finally {
          this._skillsSetupInProgress = false;
        }
      }

      // Build available skills section dynamically — now handled by pi's DefaultResourceLoader
      // via additionalSkillPaths. No custom prompt building needed.

      log("[AgentRunner] App deskwand dir:", userDeskWandDir);
      log("[AgentRunner] User working directory:", workingDir);

      logTiming("before building conversation context", runStartTime);

      // pi-ai handles auth and model routing natively — no proxy, no env overrides needed.
      logCtx(
        "[AgentRunner] Using pi-ai native routing for:",
        piModel.provider,
        piModel.id,
      );

      // Resolve thinking level from session preference — needed for session reuse check below
      type PiThinkingLevel =
        | "off"
        | "minimal"
        | "low"
        | "medium"
        | "high"
        | "xhigh";
      const thinkingLevel: PiThinkingLevel =
        (session.thinkingLevel as PiThinkingLevel | undefined) || "medium";
      logCtx("[AgentRunner] Session thinking level:", thinkingLevel);
      const sessionRuntimeSignature = buildPiSessionRuntimeSignature({
        configProvider: provider,
        customProtocol: runtimeConfig.customProtocol,
        modelProvider: piModel.provider,
        modelApi: piModel.api,
        modelBaseUrl: piModel.baseUrl,
        contextWindow: piModel.contextWindow,
        maxTokens: piModel.maxTokens,
        effectiveCwd,
        apiKey,
      });
      const { skillPaths } = await this.resolveSkillPaths();
      const skillsSignature = JSON.stringify(
        skillPaths.map(p => {
          try {
            return `${p}:[${fs.readdirSync(p, { withFileTypes: true })
              .filter(d => d.isDirectory())
              .map(d => d.name).sort().join(',')}]`;
          } catch { return p; }
        })
      );
      log("[AgentRunner] Skill paths for pi ResourceLoader:", skillPaths);

      // Build contextual prompt — if reusing an existing SDK session, the SDK
      // already has conversation history so we only pass the new prompt.
      // For cold starts (new SDK session with existing DB history), we inject
      // a token-budgeted summary of recent history as a preamble.
      let cachedSession = this.piSessions.get(session.id);
      if (
        cachedSession &&
        cachedSession.runtimeSignature !== sessionRuntimeSignature
      ) {
        logCtx(
          "[AgentRunner] Runtime changed, recreating cached pi session:",
          session.id,
        );
        try {
          cachedSession.session.dispose();
        } catch (disposeError) {
          logWarn(
            "[AgentRunner] dispose error while recreating pi session:",
            disposeError,
          );
        }
        this.piSessions.delete(session.id);
        cachedSession = undefined;
      }
      if (cachedSession && cachedSession.skillsSignature !== skillsSignature) {
        logCtx(
          "[AgentRunner] Skills changed, recreating cached pi session:",
          session.id,
        );
        try {
          cachedSession.session.dispose();
        } catch (disposeError) {
          logWarn(
            "[AgentRunner] dispose error while recreating pi session for skills:",
            disposeError,
          );
        }
        this.piSessions.delete(session.id);
        cachedSession = undefined;
      }

      const extensionResult = this.extensionManager
        ? await this.extensionManager.beforeSessionRun({
            session,
            prompt,
            existingMessages,
            isColdStart: !cachedSession,
          })
        : { promptPrefix: undefined, customTools: [] };

      let contextualPrompt = prompt;
      if (!cachedSession) {
        // Cold start: inject recent history into prompt if available
        const conversationMessages = existingMessages.filter(
          (msg) => msg.role === "user" || msg.role === "assistant",
        );
        // Filter out messages that contain images (images can't be serialized into text preamble)
        const textOnlyMessages = conversationMessages.filter(
          (msg) =>
            !msg.content.some((c) => (c as { type?: string }).type === "image"),
        );
        const historyMessages =
          textOnlyMessages.length > 0 &&
          textOnlyMessages[textOnlyMessages.length - 1]?.role === "user"
            ? textOnlyMessages.slice(0, -1)
            : textOnlyMessages;

        if (historyMessages.length > 0) {
          // Content-aware chars-per-token estimation (CJK text uses ~1.5 chars/token vs ~4 for English)
          const contextWindow = piModel.contextWindow || 128000;
          const historyBudgetRatio =
            provider === "ollama" && contextWindow < 16384 ? 0.15 : 0.3;
          const historyTokenBudget = Math.floor(
            contextWindow * historyBudgetRatio,
          );

          // Sample recent messages to estimate chars-per-token ratio
          const sampleText = historyMessages
            .slice(-3)
            .flatMap((m) =>
              m.content
                .filter((c) => c.type === "text")
                .map((c) => (c as { text: string }).text),
            )
            .join("");
          const charsPerToken = estimateCharsPerToken(sampleText);
          const historyCharBudget = Math.floor(
            historyTokenBudget * charsPerToken,
          );

          const historyItems: string[] = [];
          let charCount = 0;
          // Build from newest to oldest, then reverse
          for (let i = historyMessages.length - 1; i >= 0; i--) {
            const msg = historyMessages[i];
            const textContent = msg.content
              .filter((c) => c.type === "text")
              .map((c) => (c as { text: string }).text)
              .join("\n");
            const roleTag = msg.role === "user" ? "user" : "assistant";
            const entry = `<turn role="${roleTag}">${textContent}</turn>`;
            if (charCount + entry.length > historyCharBudget) break;
            charCount += entry.length;
            historyItems.unshift(entry);
          }

          if (historyItems.length > 0) {
            const trimmedCount = historyMessages.length - historyItems.length;
            const historyNote =
              trimmedCount > 0
                ? `[${trimmedCount} older messages omitted]\n`
                : "";
            const preamble = `<conversation_history>\n${historyNote}${historyItems.join("\n")}\n</conversation_history>`;
            contextualPrompt = `${preamble}\n\n${prompt}`;
            log(
              "[AgentRunner] Cold start: injecting",
              historyItems.length,
              "of",
              historyMessages.length,
              "history messages (budget:",
              historyCharBudget,
              "chars, used:",
              charCount,
              ", charsPerToken:",
              charsPerToken.toFixed(2),
              ")",
            );
          }
        }
      } else {
        // Reusing session — SDK already has the full conversation context
        logCtx("[AgentRunner] Reusing existing SDK session for:", session.id);
      }
      if (extensionResult.promptPrefix?.trim()) {
        contextualPrompt = `${extensionResult.promptPrefix.trim()}\n\n${contextualPrompt}`;
      }

      logTiming("before building MCP servers config", runStartTime);

      // Build MCP servers configuration for SDK
      // IMPORTANT: SDK uses tool names in format: mcp__<ServerKey>__<toolName>
      const mcpServers: Record<string, unknown> = {};
      if (this.mcpManager) {
        const serverStatuses = this.mcpManager.getServerStatus();
        const connectedServers = serverStatuses.filter((s) => s.connected);
        log(
          "[AgentRunner] MCP server statuses:",
          safeStringify(serverStatuses),
        );
        log("[AgentRunner] Connected MCP servers:", connectedServers.length);

        let allConfigs: ReturnType<typeof mcpConfigStore.getEnabledServers> =
          [];
        try {
          allConfigs = mcpConfigStore.getEnabledServers();
          log(
            "[AgentRunner] Enabled MCP configs:",
            allConfigs.map((c) => c.name),
          );
        } catch (error) {
          logWarn(
            "[AgentRunner] Failed to read enabled MCP configs; MCP tools will be unavailable this query",
            error,
          );
          allConfigs = [];
        }

        // Cache key: serialized config list + imageCapable flag.  The bundled node
        // paths are stable for the lifetime of the process so they don't need to be
        // part of the fingerprint.
        const mcpFingerprint =
          JSON.stringify(allConfigs) + String(imageCapable);
        if (this._mcpServersCache?.fingerprint === mcpFingerprint) {
          Object.assign(mcpServers, this._mcpServersCache.servers);
          log("[AgentRunner] MCP servers config reused from cache");
        } else {
          // Use the module-level memoized helper — no more per-query fs.existsSync calls.
          const bundledNodePaths = getBundledNodePaths();
          const bundledNpx = bundledNodePaths?.npx ?? null;

          for (const config of allConfigs) {
            try {
              // Use a simpler key without spaces to avoid issues
              const serverKey = config.name;

              if (config.type === "stdio") {
                // 当命令是 npx 或 node 时优先使用内置路径
                const command =
                  config.command === "npx" && bundledNpx
                    ? bundledNpx
                    : config.command === "node" && bundledNodePaths
                      ? bundledNodePaths.node
                      : config.command;

                // 使用内置 npx/node 时，将内置 node bin 注入 PATH
                const serverEnv = { ...config.env };
                if (
                  bundledNodePaths &&
                  (config.command === "npx" || config.command === "node")
                ) {
                  const nodeBinDir = path.dirname(bundledNodePaths.node);
                  const currentPath = process.env.PATH || "";
                  // Prepend bundled node bin to PATH so npx can find node
                  serverEnv.PATH = `${nodeBinDir}${path.delimiter}${currentPath}`;
                  log(
                    `[AgentRunner]   Added bundled node bin to PATH: ${nodeBinDir}`,
                  );
                }

                if (!imageCapable) {
                  serverEnv.OPEN_COWORK_DISABLE_IMAGE_TOOL_OUTPUT = "1";
                }

                // Resolve path placeholders for presets
                let resolvedArgs = config.args || [];

                // Check if any args contain placeholders that need resolving
                const hasPlaceholders = resolvedArgs.some(
                  (arg) =>
                    arg.includes("{SOFTWARE_DEV_SERVER_PATH}") ||
                    arg.includes("{GUI_OPERATE_SERVER_PATH}"),
                );

                if (hasPlaceholders) {
                  // Get the appropriate preset based on config name
                  let presetKey: string | null = null;
                  if (
                    config.name === "Software_Development" ||
                    config.name === "Software Development"
                  ) {
                    presetKey = "software-development";
                  } else if (
                    config.name === "GUI_Operate" ||
                    config.name === "GUI Operate"
                  ) {
                    presetKey = "gui-operate";
                  }

                  if (presetKey) {
                    const preset = mcpConfigStore.createFromPreset(
                      presetKey,
                      true,
                    );
                    if (preset && preset.args) {
                      resolvedArgs = preset.args;
                    }
                  }
                }

                mcpServers[serverKey] = {
                  type: "stdio",
                  command,
                  args: resolvedArgs,
                  env: serverEnv,
                };
                log(`[AgentRunner] Added STDIO MCP server: ${serverKey}`);
                log(
                  `[AgentRunner]   Command: ${command} ${resolvedArgs.join(" ")}`,
                );
                log(
                  `[AgentRunner]   Tools will be named: mcp__${serverKey}__<toolName>`,
                );
              } else if (config.type === "sse") {
                mcpServers[serverKey] = {
                  type: "sse",
                  url: config.url,
                  headers: config.headers || {},
                };
                log(`[AgentRunner] Added SSE MCP server: ${serverKey}`);
              }
            } catch (error) {
              logError(
                "[AgentRunner] Failed to prepare MCP server config, skipping server",
                {
                  serverId: config.id,
                  serverName: config.name,
                  error: toErrorText(error),
                },
              );
            }
          }

          // Store in cache for subsequent queries
          this._mcpServersCache = {
            fingerprint: mcpFingerprint,
            servers: { ...mcpServers },
          };
        }

        const mcpServersSummary = Object.entries(mcpServers).map(
          ([name, serverConfig]) => {
            const typedServerConfig = serverConfig as {
              type?: string;
              command?: string;
              args?: unknown[];
              env?: Record<string, unknown>;
            };
            return {
              name,
              type: typedServerConfig.type ?? "unknown",
              command: typedServerConfig.command ?? "",
              argsCount: Array.isArray(typedServerConfig.args)
                ? typedServerConfig.args.length
                : 0,
              envKeys: typedServerConfig.env
                ? Object.keys(typedServerConfig.env).length
                : 0,
            };
          },
        );
        log(
          "[AgentRunner] Final mcpServers summary:",
          safeStringify(mcpServersSummary, 2),
        );
        if (process.env.COWORK_LOG_SDK_MESSAGES_FULL === "1") {
          log(
            "[AgentRunner] Final mcpServers config:",
            safeStringify(mcpServers, 2),
          );
        }
      }
      logTiming("after building MCP servers config", runStartTime);

      const workspaceInfoPrompt =
        useSandboxIsolation && sandboxPath
          ? `<workspace_info>
Your current workspace is located at: ${VIRTUAL_WORKSPACE_PATH}
This is an isolated sandbox environment. Use ${VIRTUAL_WORKSPACE_PATH} as the root path for file operations.
</workspace_info>`
          : workingDir
            ? `<workspace_info>Your current workspace is: ${workingDir}</workspace_info>`
            : "";

      const coworkAppendPrompt = [
        "You are an DeskWand assistant. Be concise, accurate, and tool-capable.",
        `CRITICAL BEHAVIORAL RULES:\n
1. CHAT FIRST: By default, respond to the user in plain text within the conversation. Do NOT create, write, or edit files unless the user explicitly asks you to (e.g., \"create a file\", \"write this to...\", \"edit the code\", \"save as...\", mentions a specific file path, or describes code changes they want applied). For questions, summaries, explanations, analysis, and general conversation — always reply directly in chat text.\n
2. When a request is actionable, proceed immediately with reasonable assumptions. If you need clarification, ask briefly in plain text.\n
3. For relative time windows like \"within two days\" in browsing or research tasks, assume the most recent two relevant publication days unless the user explicitly defines another date range.\n
4. For bracketed placeholders like [Agent], [Topic], etc., treat the word inside brackets as the literal search keyword unless the user says otherwise.\n
5. When given a task, START DOING IT. Do not restate the task, do not list what you will do, do not ask for confirmation. Just execute.`,
        workspaceInfoPrompt,
        `\u003ccitation_requirements>\n
If your answer uses linkable content from MCP tools, include a \"Sources:\" section and otherwise use standard Markdown links: [Title](https://deskwand.ai/chat/URL).\n
\u003c/citation_requirements>`,
        `\u003ctool_behavior\u003e\n
Tool routing:\n
- internal_browser_*: Use for all web browsing, interactive page operations, screenshots, form filling, and JS evaluation. The browser panel opens automatically. If it doesn't, the user may have dismissed it — they can reopen it by clicking the globe icon \ud83c\udf10 in the top toolbar.\n
- WebSearch/WebFetch: Use for quick lookups and content fetching when full interactive browsing is unnecessary.\n
\u003c/tool_behavior\u003e`,
        this.getBundledPathHints(),
      ].filter((section): section is string =>
        Boolean(section && section.trim()),
      );

      logTiming("before pi-coding-agent session creation", runStartTime);

      // Create or reuse pi-coding-agent session
      // Bridge MCP tools as customTools for pi-coding-agent.
      // Re-read every query so newly added/removed MCP servers take effect immediately.
      const mcpCustomTools = this.mcpManager
        ? buildMcpCustomTools(this.mcpManager)
        : [];

      const internalBrowserTools = this.buildInternalBrowserTools();
      const webTools = this.buildWebTools();

      const extensionCustomTools = extensionResult.customTools || [];
      const customTools = [
        ...mcpCustomTools,
        ...internalBrowserTools,
        ...webTools,
        ...extensionCustomTools,
      ];
      if (mcpCustomTools.length > 0) {
        log(
          `[AgentRunner] Registered ${mcpCustomTools.length} MCP tools as customTools:`,
          mcpCustomTools.map((t) => t.name).join(", "),
        );
      }
      if (extensionCustomTools.length > 0) {
        log(
          `[AgentRunner] Registered ${extensionCustomTools.length} extension tools as customTools:`,
          extensionCustomTools.map((t) => t.name).join(", "),
        );
      }
      if (webTools.length > 0) {
        log(
          `[AgentRunner] Registered ${webTools.length} web tools as customTools:`,
          webTools.map((t) => t.name).join(", "),
        );
      }

      // Enrich process.env.PATH for build mode — ensures Skill commands (python3, node)
      // executed via Pi SDK's Bash tool can find bundled and user-installed executables.
      await enrichProcessPathForBuild();

      const codingTools = createCodingTools(effectiveCwd);

      // Inject a default 120s timeout for bash commands when the model omits one
      const withTimeout = AgentRunner.wrapBashToolWithDefaultTimeout(
        codingTools as ToolDefinition[],
      );

      // Wrap the bash tool to intercept sudo commands and request passwords
      // wrappedTools = all 4 tools with bash wrapped; we extract bash for customTools override below
      const wrappedTools = this.wrapBashToolForSudo(
        withTimeout,
        session.id,
        effectiveCwd,
      );

      // 0.78.0 SDK: tools is string[] (tool name filter), customTools overrides built-in tools.
      // Extract the wrapped bash tool to inject our sudo/timeout interceptors
      const wrappedBashTool = wrappedTools.find((t) => t.name === "bash");
      const allCustomTools = [
        ...customTools,
        ...this._customTools, // background review tools
        ...(wrappedBashTool ? [wrappedBashTool] : []),
      ];

      // Diagnostic: log tools being passed to SDK (helps debug Ollama tool use)
      logCtx(`[AgentRunner] Session reuse check: cached=${!!cachedSession}`);
      logCtx(
        `[AgentRunner] Model=${piModel.id}, thinkingLevel=${thinkingLevel}`,
      );
      log(`[AgentRunner] Active tools: read, bash, edit, write`);
      log(
        `[AgentRunner] Custom tools (${allCustomTools.length}): ${allCustomTools.map((t) => t.name).join(", ")}`,
      );

      // Detect MCP tool changes so newly enabled/disabled MCP servers take effect
      const toolsSignature = JSON.stringify(
        allCustomTools.map((t) => t.name).sort(),
      );
      if (cachedSession && cachedSession.toolsSignature !== toolsSignature) {
        logCtx(
          "[AgentRunner] Custom tools changed, recreating cached pi session:",
          session.id,
        );
        try {
          cachedSession.session.dispose();
        } catch (disposeError) {
          logWarn(
            "[AgentRunner] dispose error while recreating pi session for tools:",
            disposeError,
          );
        }
        this.piSessions.delete(session.id);
        cachedSession = undefined;
      }

      let piSession: PiAgentSession;
      if (cachedSession) {
        // Reuse existing session — SDK retains full conversation history and handles compaction
        piSession = cachedSession.session;

        // Hot-swap model/thinking if changed — SDK supports this natively
        if (cachedSession.modelId !== piModel.id) {
          logCtx(
            "[AgentRunner] Model changed, hot-swapping:",
            cachedSession.modelId,
            "→",
            piModel.id,
          );
          await piSession.setModel(piModel);
          cachedSession.modelId = piModel.id;
          // Update Ollama num_ctx ref if present
          if (cachedSession.ollamaNumCtx) {
            cachedSession.ollamaNumCtx.value = piModel.contextWindow || 128000;
            log(
              "[AgentRunner] Updated Ollama num_ctx on hot-swap:",
              cachedSession.ollamaNumCtx.value,
            );
          }
        }
        if (cachedSession.thinkingLevel !== thinkingLevel) {
          logCtx(
            "[AgentRunner] Thinking level changed, hot-swapping:",
            cachedSession.thinkingLevel,
            "→",
            thinkingLevel,
          );
          piSession.setThinkingLevel(thinkingLevel);
          cachedSession.thinkingLevel = thinkingLevel;
        }

        logCtx("[AgentRunner] Reusing cached pi session for:", session.id);
        logTiming("pi-coding-agent session reused", runStartTime);
      } else {
        // First query in this session — create new pi-coding-agent session
        // ResourceLoader + ModelRegistry only needed for session creation — skip on reuse
        const { DefaultResourceLoader } =
          await import("@earendil-works/pi-coding-agent");
        const resourceLoader = new DefaultResourceLoader({
          cwd: effectiveCwd,
          agentDir: userDeskWandDir,
          additionalSkillPaths: skillPaths,
          appendSystemPrompt: coworkAppendPrompt,
        });
        await resourceLoader.reload();

        const modelRegistry = ModelRegistry.inMemory(authStorage);

        // Ollama-specific compaction tuning based on actual context window
        const contextWindow = piModel.contextWindow || 128000;
        let compactionSettings: {
          enabled: boolean;
          reserveTokens?: number;
          keepRecentTokens?: number;
        };
        if (provider === "ollama" && contextWindow < 16384) {
          // Very small context: disable compaction (weak models produce unreliable summaries)
          compactionSettings = { enabled: false };
          log(
            "[AgentRunner] Ollama small context model, disabling auto-compaction (contextWindow:",
            contextWindow,
            ")",
          );
        } else if (provider === "ollama" && contextWindow < 65536) {
          // Medium context: scale reserves proportionally
          compactionSettings = {
            enabled: true,
            reserveTokens: Math.floor(contextWindow * 0.15),
            keepRecentTokens: Math.floor(contextWindow * 0.25),
          };
          log(
            "[AgentRunner] Ollama medium context, scaled compaction:",
            JSON.stringify(compactionSettings),
          );
        } else {
          compactionSettings = { enabled: true };
        }

        const { session: newPiSession, extensionsResult } =
          await createAgentSession({
            model: piModel,
            thinkingLevel,
            authStorage,
            modelRegistry,
            // tools intentionally left as default — customTools (including MCP)
            // provide their own activation through includeAllExtensionTools.
            customTools: allCustomTools,
            sessionManager: PiSessionManager.inMemory(),
            settingsManager: PiSettingsManager.inMemory({
              compaction: compactionSettings,
              retry: { enabled: true, maxRetries: 2 },
            }),
            resourceLoader,
            cwd: effectiveCwd,
          });
        piSession = newPiSession;

        // Extract extension commands (registered via pi.registerCommand during load)
        const extCmds: { name: string; description: string }[] = [];
        for (const ext of extensionsResult.extensions) {
          for (const [name, cmd] of ext.commands) {
            extCmds.push({ name, description: cmd.description || "" });
          }
        }
        if (
          Array.isArray(extensionsResult.errors) &&
          extensionsResult.errors.length > 0
        ) {
          log(
            "[AgentRunner] createAgentSession: extension load errors:",
            extensionsResult.errors.map(
              (e: Record<string, unknown>) =>
                `[${e.path || "?"}] ${e.error || String(e)}`,
            ),
          );
        }

        // Store session for reuse — evict oldest if cache is full
        if (this.piSessions.size >= AgentRunner.MAX_CACHED_SESSIONS) {
          const oldestKey = this.piSessions.keys().next().value;
          if (oldestKey) {
            const oldest = this.piSessions.get(oldestKey);
            if (oldest) {
              try {
                oldest.session.dispose();
              } catch (e) {
                logWarn("[AgentRunner] dispose error on eviction:", e);
              }
            }
            this.piSessions.delete(oldestKey);
            log("[AgentRunner] Evicted oldest cached session:", oldestKey);
          }
        }
        this.piSessions.set(session.id, {
          session: piSession,
          modelId: piModel.id,
          thinkingLevel,
          runtimeSignature: sessionRuntimeSignature,
          skillsSignature,
          toolsSignature,
          extensionCommands: extCmds,
        });

        // Ollama: wrap _onPayload to inject num_ctx into every request
        if (provider === "ollama") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const agent = piSession.agent as any;
          // Guard: only patch if the SDK exposes _onPayload (private API)
          if (!("_onPayload" in agent)) {
            logWarn(
              "[AgentRunner] SDK agent does not expose _onPayload — skipping Ollama num_ctx patch",
            );
          } else {
            const originalOnPayload = agent._onPayload as
              | ((
                  payload: Record<string, unknown>,
                  modelArg: unknown,
                ) => Promise<Record<string, unknown>>)
              | undefined;
            const ollamaNumCtx = {
              value: piModel.contextWindow || 128000,
            };
            agent._onPayload = async (
              payload: Record<string, unknown>,
              modelArg: unknown,
            ) => {
              let result = originalOnPayload
                ? await originalOnPayload.call(agent, payload, modelArg)
                : payload;
              if (result === undefined) result = payload;
              return { ...result, num_ctx: ollamaNumCtx.value };
            };
            this.piSessions.get(session.id)!.ollamaNumCtx = ollamaNumCtx;
            log(
              "[AgentRunner] Ollama _onPayload wrapper installed, num_ctx:",
              ollamaNumCtx.value,
            );
          } // end else (_onPayload exists)
        }

        logTiming("pi-coding-agent session created", runStartTime);
      }

      // Set up event handler to bridge pi-coding-agent events → our ServerEvent protocol

      // Accumulate streamed text deltas in case message_end.content is empty (pi SDK streaming behaviour)
      let streamedText = "";
      let compactionStepId: string | undefined;
      let hasEmittedError = false;
      let terminalErrorText: string | undefined;
      const thinkParser = new ThinkTagStreamParser();
      const promptStartedAt = Date.now();
      const streamEventCounts = new Map<string, number>();

      // Ollama cold-start feedback: if provider is 'ollama' and no stream event arrives
      // within 10 seconds, show a "model loading" trace update so users know what's happening.
      let ollamaColdStartTimerId: ReturnType<typeof setTimeout> | undefined;
      let receivedFirstStreamEvent = false;
      let firstStreamEventAt: number | undefined;
      if (provider === "ollama") {
        ollamaColdStartTimerId = setTimeout(() => {
          if (!receivedFirstStreamEvent && !controller.signal.aborted) {
            this.sendTraceUpdate(session.id, thinkingStepId, {
              title: "Waiting for model to load into memory...",
            });
          }
        }, 10000);
      }

      const markFirstStreamEvent = (eventType: string) => {
        if (receivedFirstStreamEvent) {
          return;
        }
        receivedFirstStreamEvent = true;
        firstStreamEventAt = Date.now();
        if (ollamaColdStartTimerId) {
          clearTimeout(ollamaColdStartTimerId);
        }
        this.sendTraceUpdate(session.id, thinkingStepId, {
          title: "Processing request...",
        });
        if (provider === "ollama") {
          log(
            "[AgentRunner] Ollama first stream event received",
            safeStringify({
              sessionId: session.id,
              eventType,
              modelId: piModel.id,
              modelProvider: piModel.provider,
              baseUrl: piModel.baseUrl || runtimeConfig.baseUrl || "",
              latencyMs: firstStreamEventAt - promptStartedAt,
            }),
          );
        }
      };

      // Activity-based timeout: reset the 5-min timer whenever the SDK sends events
      const PROMPT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
      let activityTimeoutId: ReturnType<typeof setTimeout> | undefined;
      const resetActivityTimeout = () => {
        if (activityTimeoutId) clearTimeout(activityTimeoutId);
        activityTimeoutId = setTimeout(() => {
          logWarn(
            "[AgentRunner] Prompt timed out (no activity for 5 min), aborting",
          );
          abortedByTimeout = true;
          controller.abort();
        }, PROMPT_TIMEOUT_MS);
      };

      const recordStreamEvent = (eventType: string) => {
        streamEventCounts.set(
          eventType,
          (streamEventCounts.get(eventType) ?? 0) + 1,
        );
      };

      const getStreamEventSummary = () =>
        Object.fromEntries(
          Array.from(streamEventCounts.entries()).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        );

      const unsubscribe = piSession.subscribe((event) => {
        try {
          if (controller.signal.aborted) return;

          // Reset activity timeout on meaningful events
          resetActivityTimeout();

          if (event.type === "message_update") {
            const updateType = event.assistantMessageEvent.type;
            recordStreamEvent(updateType);
            if (
              updateType !== "text_delta" &&
              updateType !== "thinking_delta" &&
              updateType !== "toolcall_delta"
            ) {
              log(`[AgentRunner] Event: ${event.type} → ${updateType}`);
            }
          } else if (event.type === "message_start") {
            log(
              "[AgentRunner] Event: message_start",
              safeStringify(summarizeMessageForLog(event.message), 2),
            );
          } else if (event.type === "message_end") {
            log(
              "[AgentRunner] Event: message_end",
              safeStringify(
                {
                  message: summarizeMessageForLog(event.message),
                  messageUpdateCounts: getStreamEventSummary(),
                },
                2,
              ),
            );
          } else if (event.type === "turn_end") {
            log(`[AgentRunner] Event: ${event.type}`);
          } else {
            log(`[AgentRunner] Event: ${event.type}`);
          }

          switch (event.type) {
            case "queue_update":
              log(
                "[AgentRunner] queue_update steering=%d followUp=%d",
                event.steering.length,
                event.followUp.length,
              );
              break;
            case "message_update": {
              if (controller.signal.aborted) break;
              const ame = event.assistantMessageEvent;
              if (ame.type === "text_delta") {
                markFirstStreamEvent(ame.type);
                const parsed = thinkParser.push(ame.delta);
                if (parsed.thinking) {
                  this.sendToRenderer({
                    type: "stream.thinking",
                    payload: {
                      sessionId: session.id,
                      delta: parsed.thinking,
                      turnId,
                    },
                  });
                }
                if (parsed.text) {
                  streamedText += parsed.text;
                  this.sendPartial(session.id, parsed.text, turnId);
                }
              } else if (ame.type === "thinking_delta") {
                markFirstStreamEvent(ame.type);
                // Forward thinking delta to renderer for real-time display
                this.sendToRenderer({
                  type: "stream.thinking",
                  payload: { sessionId: session.id, delta: ame.delta, turnId },
                });
              } else if (ame.type === "toolcall_start") {
                markFirstStreamEvent(ame.type);
                const partial = ame.partial;
                const toolContent = partial?.content?.[ame.contentIndex];
                const toolName =
                  toolContent?.type === "toolCall"
                    ? toolContent.name
                    : "unknown";
                const toolCallId =
                  toolContent?.type === "toolCall" ? toolContent.id : uuidv4();
                this.sendTraceStep(session.id, {
                  id: toolCallId,
                  type: "tool_call",
                  status: "running",
                  title: toolName,
                  toolName,
                  toolInput:
                    toolContent?.type === "toolCall"
                      ? (toolContent.arguments as Record<string, unknown>) || {}
                      : undefined,
                  timestamp: Date.now(),
                });
              } else if (ame.type === "done") {
                // Some providers emit 'done' via message_update — we handle it
                // in message_end below as a unified path for all providers.
                log(
                  "[AgentRunner] message_update done event (handled in message_end)",
                );
              } else if (ame.type === "error") {
                const errorDetail = JSON.stringify(
                  ame.error?.content || "no content",
                );
                logCtxError(
                  "[AgentRunner] pi-ai stream error:",
                  ame.reason,
                  errorDetail,
                );
              }
              break;
            }

            case "message_end": {
              // Unified handler: send the final assistant message to the renderer.
              // Works for all providers (some emit 'done' via message_update, others don't).
              if (controller.signal.aborted) break;

              // Flush any buffered content from the think-tag parser
              const flushed = thinkParser.flush();
              if (flushed.thinking) {
                this.sendToRenderer({
                  type: "stream.thinking",
                  payload: {
                    sessionId: session.id,
                    delta: flushed.thinking,
                    turnId,
                  },
                });
              }
              if (flushed.text) {
                streamedText += flushed.text;
                this.sendPartial(session.id, flushed.text, turnId);
              }

              const msg = event.message;
              if (process.env.COWORK_LOG_SDK_MESSAGES_FULL === "1") {
                log(
                  "[AgentRunner] message_end raw message:",
                  safeStringify(msg, 2),
                );
              }
              const resolvedPayload = resolveMessageEndPayload({
                message: msg as Parameters<
                  typeof resolveMessageEndPayload
                >[0]["message"],
                streamedText,
              });
              streamedText = resolvedPayload.nextStreamedText;
              if (provider === "ollama") {
                log(
                  "[AgentRunner] Ollama message_end diagnostics",
                  safeStringify({
                    sessionId: session.id,
                    modelId: piModel.id,
                    modelProvider: piModel.provider,
                    usedSyntheticModel:
                      resolvedRuntime.trace.piModelSource === "synthetic",
                    receivedFirstStreamEvent,
                    firstStreamLatencyMs: firstStreamEventAt
                      ? firstStreamEventAt - promptStartedAt
                      : null,
                    stopReason:
                      (msg as { stopReason?: unknown })?.stopReason ?? null,
                    contentBlocks: Array.isArray(
                      (msg as { content?: unknown[] })?.content,
                    )
                      ? ((msg as { content?: unknown[] }).content?.length ?? 0)
                      : 0,
                    emittedError: Boolean(resolvedPayload.errorText),
                  }),
                );
              }
              if (resolvedPayload.errorText) {
                terminalErrorText = resolvedPayload.errorText;
                if (!hasEmittedError) {
                  hasEmittedError = true;
                  this.sendMessage(session.id, {
                    id: uuidv4(),
                    sessionId: session.id,
                    role: "assistant",
                    turnId,
                    content: [
                      {
                        type: "text",
                        text: `**Error**: ${resolvedPayload.errorText}\n\n${
                          /\b4\d{2}\b/.test(resolvedPayload.errorText)
                            ? "_请检查配置后重试。_"
                            : "_Agent 正在自动重试，请稍候..._"
                        }`,
                      },
                    ],
                    timestamp: Date.now(),
                    executionTimeMs: Date.now() - runStartTime,
                  });
                }
                break;
              }
              if (resolvedPayload.shouldEmitMessage) {
                const contentBlocks: ContentBlock[] = [];
                for (const block of resolvedPayload.effectiveContent) {
                  if (block.type === "text") {
                    const { cleanText, artifacts } = extractArtifactsFromText(
                      block.text,
                    );
                    if (cleanText) {
                      contentBlocks.push({
                        type: "text",
                        text: sanitizeOutputPaths(cleanText),
                      });
                    }
                    if (artifacts.length > 0) {
                      for (const step of buildArtifactTraceSteps(artifacts)) {
                        this.sendTraceStep(session.id, step);
                      }
                    }
                  } else if (block.type === "toolCall") {
                    contentBlocks.push({
                      type: "tool_use",
                      id: block.id,
                      name: block.name,
                      input: block.arguments,
                    });
                  } else if (block.type === "thinking") {
                    contentBlocks.push({
                      type: "thinking",
                      thinking: block.thinking,
                    });
                  } else {
                    // Unknown block type — pass through as text so content isn't silently lost
                    const unknownBlock = block as {
                      type?: string;
                      text?: string;
                    };
                    log(
                      `[AgentRunner] Unknown content block type: ${unknownBlock.type}`,
                    );
                    const text = unknownBlock.text || JSON.stringify(block);
                    if (text) contentBlocks.push({ type: "text", text });
                  }
                }
                // Always clear partial text; send message even if only artifacts were extracted
                this.sendToRenderer({
                  type: "stream.partial",
                  payload: { sessionId: session.id, delta: "", turnId },
                });
                if (contentBlocks.length > 0) {
                  const msgWithUsage = msg as { usage?: unknown };
                  const tokenUsage = normalizeTokenUsage(
                    msgWithUsage.usage,
                    piModel.provider,
                  );
                  if (msgWithUsage.usage) {
                    log(
                      "[AgentRunner] normalized usage:",
                      safeStringify(
                        {
                          raw: msgWithUsage.usage,
                          normalized: tokenUsage,
                        },
                        2,
                      ),
                    );
                  }
                  const assistantMsg: Message = {
                    id: uuidv4(),
                    sessionId: session.id,
                    role: "assistant",
                    content: contentBlocks,
                    timestamp: Date.now(),
                    turnId,
                    tokenUsage,
                    executionTimeMs: Date.now() - runStartTime,
                  };
                  this.sendMessage(session.id, assistantMsg);
                }
              }
              break;
            }

            case "tool_execution_start": {
              logCtx(`[AgentRunner] Tool execution start: ${event.toolName}`);
              break;
            }

            case "tool_execution_end": {
              if (controller.signal.aborted) break;
              const toolCallId = event.toolCallId;
              const isError = event.isError;
              const normalizedToolResult = normalizeToolExecutionResultForUi(
                event.result,
              );
              const outputText = normalizedToolResult.content;
              this.sendTraceUpdate(session.id, toolCallId, {
                status: isError ? "error" : "completed",
                toolName: event.toolName,
                toolOutput: sanitizeOutputPaths(outputText).slice(0, 800),
              });

              // Send tool result message
              const toolResultMsg: Message = {
                id: uuidv4(),
                sessionId: session.id,
                role: "assistant",
                turnId,
                content: [
                  {
                    type: "tool_result",
                    toolUseId: toolCallId,
                    content: sanitizeOutputPaths(outputText),
                    isError,
                    ...(normalizedToolResult.images.length > 0
                      ? { images: normalizedToolResult.images }
                      : {}),
                  },
                ],
                timestamp: Date.now(),
              };
              this.sendMessage(session.id, toolResultMsg);
              break;
            }

            case "agent_end": {
              logCtx("[AgentRunner] Agent finished");
              break;
            }

            case "compaction_start": {
              log(
                "[AgentRunner] Auto-compaction started, reason:",
                event.reason,
              );
              compactionStepId = `compaction-${Date.now()}`;
              this.sendTraceStep(session.id, {
                id: compactionStepId,
                type: "thinking",
                status: "running",
                title: `Compacting context (${event.reason})...`,
                timestamp: Date.now(),
              });
              break;
            }

            case "compaction_end": {
              const status = event.aborted
                ? "error"
                : event.errorMessage
                  ? "error"
                  : "completed";
              const title = event.aborted
                ? "Context compaction aborted"
                : event.errorMessage
                  ? `Context compaction failed: ${event.errorMessage}`
                  : "Context compaction completed";
              log(
                "[AgentRunner] Auto-compaction ended:",
                title,
                "willRetry:",
                event.willRetry,
              );
              if (compactionStepId) {
                this.sendTraceUpdate(session.id, compactionStepId, {
                  status,
                  title,
                });
                compactionStepId = undefined;
              } else {
                // Fallback: no matching start event, send as new step
                this.sendTraceStep(session.id, {
                  id: `compaction-end-${Date.now()}`,
                  type: "thinking",
                  status,
                  title,
                  timestamp: Date.now(),
                });
              }
              break;
            }
          }
        } catch (subscribeErr) {
          logError("[AgentRunner] Error in subscribe callback:", subscribeErr);
          if (compactionStepId) {
            this.sendTraceUpdate(session.id, compactionStepId, {
              status: "error",
              title: "Error during context compaction",
            });
            compactionStepId = undefined;
          }
          if (!hasEmittedError) {
            hasEmittedError = true;
            const errorText = toUserFacingErrorText(toErrorText(subscribeErr));
            this.sendMessage(session.id, {
              id: uuidv4(),
              sessionId: session.id,
              role: "assistant",
              turnId,
              content: [{ type: "text", text: `**Error**: ${errorText}` }],
              timestamp: Date.now(),
              executionTimeMs: Date.now() - runStartTime,
            });
          }
        }
      });

      // Execute the prompt — unsubscribe in finally to prevent event listener leak
      try {
        resetActivityTimeout();
        if (provider === "ollama") {
          log(
            "[AgentRunner] Starting Ollama prompt",
            safeStringify({
              sessionId: session.id,
              modelId: piModel.id,
              modelProvider: piModel.provider,
              baseUrl: piModel.baseUrl || runtimeConfig.baseUrl || "",
              usedSyntheticModel:
                resolvedRuntime.trace.piModelSource === "synthetic",
              hasExplicitApiKey: Boolean(apiKey),
              thinkingLevel,
            }),
          );
        }
        // Check if the resolved model supports images
        const modelSupportsImages = piModel.input.includes("image");

        // Extract images from last user message and convert to pi-ai ImageContent format
        const lastUserMsg = existingMessages[existingMessages.length - 1];
        const promptImages: Array<{
          type: "image";
          data: string;
          mimeType: string;
        }> =
          modelSupportsImages &&
          lastUserMsg?.role === "user" &&
          Array.isArray(lastUserMsg.content)
            ? lastUserMsg.content
                .filter((c) => (c as { type?: string }).type === "image")
                .map((c) => {
                  const img = c as {
                    type: "image";
                    source: { data: string; media_type: string };
                  };
                  return {
                    type: "image" as const,
                    data: img.source.data,
                    mimeType: img.source.media_type,
                  };
                })
            : [];

        // Try extension command interception with the raw user prompt.
        // The pi SDK's _tryExecuteExtensionCommand checks text.startsWith("/"),
        // but deskwand wraps the prompt with history/preamble (contextualPrompt),
        // which would prevent the SDK from recognizing slash commands.
        // So we detect extension commands here and pass the raw prompt.
        //
        // Extension commands (e.g. /subagents-doctor) are self-contained:
        // they execute a handler registered via pi.registerCommand() and return
        // without invoking the LLM. Passing the raw prompt is safe because the
        // handler doesn't need conversation history or preamble. If a handler
        // needs LLM access, it calls context.prompt() which goes through the
        // full SDK pipeline with system prompts already embedded in the agent.
        //
        // If the raw prompt starts with "/" but does NOT match any extension
        // command, we fall through to the normal contextualPrompt path. The
        // contextualPrompt starts with preamble (not "/"), so the SDK won't
        // attempt double-intercept. The "/..." text appears in the context and
        // the LLM will interpret it naturally as a user instruction.
        let finalPrompt = contextualPrompt;
        if (prompt.startsWith("/")) {
          const spaceIdx = prompt.indexOf(" ");
          const cmdName =
            spaceIdx > 0 ? prompt.slice(1, spaceIdx) : prompt.slice(1);
          const cached = this.piSessions.get(session.id);
          const extCmds = cached?.extensionCommands ?? [];
          if (extCmds.some((c) => c.name === cmdName)) {
            finalPrompt = prompt;
            log(
              "[AgentRunner] Extension command detected, passing raw prompt:",
              prompt,
            );
          } else {
            log(
              "[AgentRunner] Unknown '/' command, passing through to LLM: cmd=",
              cmdName,
              "knownCmds=",
              extCmds.map((c) => c.name),
            );
          }
        }

        // pony: Promise.race against abort signal so cancel() can interrupt a stuck prompt()
        const abortPromise = new Promise<never>((_, reject) => {
          const onAbort = () =>
            reject(new DOMException("Aborted", "AbortError"));
          controller.signal.addEventListener("abort", onAbort, { once: true });
        });
        const promptResult =
          promptImages.length > 0
            ? await Promise.race([
                piSession.prompt(finalPrompt, {
                  images: promptImages,
                  streamingBehavior: "steer",
                }),
                abortPromise,
              ])
            : await Promise.race([
                piSession.prompt(finalPrompt, {
                  streamingBehavior: "steer",
                }),
                abortPromise,
              ]);
        log(
          "[AgentRunner] prompt() returned:",
          JSON.stringify(promptResult ?? "void").substring(0, 1000),
        );
      } finally {
        try {
          unsubscribe();
        } catch (e) {
          logWarn("[AgentRunner] unsubscribe error:", e);
        }
        if (activityTimeoutId) clearTimeout(activityTimeoutId);
        if (ollamaColdStartTimerId) clearTimeout(ollamaColdStartTimerId);
      }

      logTiming("pi-coding-agent prompt completed", runStartTime);

      // If the SDK swallowed the AbortError and returned void, detect timeout here
      if (controller.signal.aborted && abortedByTimeout) {
        logCtx(
          "[AgentRunner] Aborted due to timeout (detected after prompt returned)",
        );
        const errorMsg: Message = {
          id: uuidv4(),
          sessionId: session.id,
          role: "assistant",
          turnId,
          content: [
            {
              type: "text",
              text: "**请求超时**：长时间未收到响应，操作已中止。",
            },
          ],
          timestamp: Date.now(),
          executionTimeMs: Date.now() - runStartTime,
        };
        this.sendMessage(session.id, errorMsg);
        this.sendTraceUpdate(session.id, thinkingStepId, {
          status: "error",
          title: "Request timed out",
        });
        return;
      }
      // Complete - update the initial thinking step
      this.sendTraceUpdate(session.id, thinkingStepId, {
        status: terminalErrorText ? "error" : "completed",
        title: terminalErrorText ? "Request failed" : "Task completed",
      });
      if (!terminalErrorText) {
        turnCompletedNormally = true;
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        if (abortedByTimeout) {
          logCtx("[AgentRunner] Aborted due to timeout");
          const errorMsg: Message = {
            id: uuidv4(),
            sessionId: session.id,
            role: "assistant",
            turnId,
            content: [
              {
                type: "text",
                text: "**请求超时**：长时间未收到响应，操作已中止。",
              },
            ],
            timestamp: Date.now(),
            executionTimeMs: Date.now() - runStartTime,
          };
          this.sendMessage(session.id, errorMsg);
          this.sendTraceUpdate(session.id, thinkingStepId, {
            status: "error",
            title: "Request timed out",
          });
        } else {
          logCtx("[AgentRunner] Aborted by user");
          this.sendTraceUpdate(session.id, thinkingStepId, {
            status: "completed",
            title: "Cancelled",
          });
        }
      } else {
        logCtxError("[AgentRunner] Error:", error);

        const errorText = toUserFacingErrorText(toErrorText(error));
        const errorMsg: Message = {
          id: uuidv4(),
          sessionId: session.id,
          role: "assistant",
          turnId,
          content: [{ type: "text", text: `**Error**: ${errorText}` }],
          timestamp: Date.now(),
          executionTimeMs: Date.now() - runStartTime,
        };
        this.sendMessage(session.id, errorMsg);

        this.sendTraceStep(session.id, {
          id: uuidv4(),
          type: "thinking",
          status: "error",
          title: "Error occurred",
          timestamp: Date.now(),
        });

        // Mark so session-manager doesn't report again
        if (error instanceof Error) {
          (
            error as Error & { alreadyReportedToUser?: boolean }
          ).alreadyReportedToUser = true;
        }
      }
    } finally {
      this.activeControllers.delete(session.id);
      this.pathResolver.unregisterSession(session.id);

      // pony: user-aborted → dispose cached piSession so next request starts fresh
      if (controller.signal.aborted && !abortedByTimeout) {
        const cached = this.piSessions.get(session.id);
        if (cached) {
          this.piSessions.delete(session.id);
          try {
            cached.session.dispose();
          } catch (e) {
            logWarn("[AgentRunner] pi session dispose error:", e);
          }
        }
      }

      // Sync changes from sandbox back to host OS (but don't cleanup - sandbox persists)
      if (useSandboxIsolation && sandboxPath) {
        try {
          const sandbox = getSandboxAdapter();

          if (sandbox.isWSL) {
            log("[AgentRunner] Syncing sandbox changes to Windows...");
            const syncResult = await SandboxSync.syncToWindows(session.id);
            if (syncResult.success) {
              log("[AgentRunner] Sync completed successfully");
            } else {
              logError("[AgentRunner] Sync failed:", syncResult.error);
            }
          } else if (sandbox.isLima) {
            log("[AgentRunner] Syncing sandbox changes to macOS...");
            const { LimaSync } = await import("../sandbox/lima-sync");
            const syncResult = await LimaSync.syncToMac(session.id);
            if (syncResult.success) {
              log("[AgentRunner] Sync completed successfully");
            } else {
              logError("[AgentRunner] Sync failed:", syncResult.error);
            }
          }
        } catch (syncErr) {
          logError("[AgentRunner] Sandbox sync error:", syncErr);
          this.sendMessage(session.id, {
            id: uuidv4(),
            sessionId: session.id,
            role: "assistant",
            turnId,
            content: [
              {
                type: "text",
                text: `**Warning**: Sandbox sync failed: ${syncErr instanceof Error ? syncErr.message : String(syncErr)}`,
              },
            ],
            timestamp: Date.now(),
            executionTimeMs: Date.now() - runStartTime,
          });
        }
      }

      // ---- Background review (skill + memory) ----
      if (this._turnFinalizer && turnCompletedNormally) {
        try {
          this._turnFinalizer.onTurnComplete({
            sessionId: session.id,
            messages: existingMessages,
            hasFinalResponse: true,
            interrupted: false,
            isProjectMode: session.isProjectMode,
          });
        } catch (reviewErr) {
          logError("[AgentRunner] TurnFinalizer error:", reviewErr);
        }
      }
    }
  }

  cancel(sessionId: string): void {
    const controller = this.activeControllers.get(sessionId);
    if (controller) controller.abort();

    // Abort the underlying pi-ai SDK session so in-flight HTTP requests
    // are interrupted. Without this, piSession.prompt() may block indefinitely.
    const cached = this.piSessions.get(sessionId);
    if (cached) {
      cached.session.abort().catch((e) => {
        logWarn("[AgentRunner] pi session abort rejected:", e);
      });
    }
  }

  /** Inject a steering message during agent execution (SDK native steer). */
  steer(sessionId: string, text: string): void {
    const cached = this.piSessions.get(sessionId);
    if (!cached) {
      logWarn("[AgentRunner] steer: no active piSession for", sessionId);
      return;
    }
    cached.session.steer(text)
      .then(() => log("[AgentRunner] steer delivered:", text.substring(0, 80)))
      .catch((e) => logError("[AgentRunner] steer failed:", e));
  }

  /** Manually compact the conversation for a session. */
  async compact(
    sessionId: string,
    instructions?: string,
  ): Promise<"compacted" | "already-compacted" | "skipped"> {
    const cached = this.piSessions.get(sessionId);
    if (!cached) {
      // pi session is lazily created on first message; if none exists yet
      // there's nothing in memory to compact — this is a no-op.
      logWarn("[AgentRunner] No active pi session to compact for:", sessionId);
      return "skipped";
    }
    try {
      await cached.session.compact(instructions);
      log("[AgentRunner] Compaction completed for session:", sessionId);
      return "compacted";
    } catch (e: any) {
      if (e?.message?.includes?.("Already compacted")) {
        log("[AgentRunner] Session already compacted:", sessionId);
        return "already-compacted";
      }
      // Treat intentional abort as a normal completion
      if (
        e?.message?.includes?.("abort") ||
        e?.message?.includes?.("aborted") ||
        e?.name === "AbortError"
      ) {
        log("[AgentRunner] Compaction aborted for session:", sessionId);
        return "compacted";
      }
      throw e;
    }
  }

  /** Abort an in-progress manual compaction for a session. */
  abortCompaction(sessionId: string): void {
    const cached = this.piSessions.get(sessionId);
    if (!cached) return;
    log("[AgentRunner] Aborting compaction for session:", sessionId);
    cached.session.abortCompaction();
  }

  private sendTraceStep(sessionId: string, step: TraceStep): void {
    log(`[Trace] ${step.type}: ${step.title}`);
    this.sendToRenderer({ type: "trace.step", payload: { sessionId, step } });
  }

  private sendTraceUpdate(
    sessionId: string,
    stepId: string,
    updates: Partial<TraceStep>,
  ): void {
    this.sendToRenderer({
      type: "trace.update",
      payload: { sessionId, stepId, updates },
    });
  }

  private sendMessage(sessionId: string, message: Message): void {
    // Save message to database for persistence
    if (this.saveMessage) {
      this.saveMessage(message);
    }
    // Send to renderer for UI update
    this.sendToRenderer({
      type: "stream.message",
      payload: { sessionId, message, turnId: message.turnId },
    });
  }

  private sendPartial(sessionId: string, delta: string, turnId?: string): void {
    this.sendToRenderer({
      type: "stream.partial",
      payload: { sessionId, delta, turnId },
    });
  }
}
