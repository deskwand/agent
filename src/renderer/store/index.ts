import { create } from "zustand";
import type {
  Session,
  Message,
  TraceStep,
  TurnState,
  PermissionRequest,
  SudoPasswordRequest,
  Settings,
  AppConfig,
  CloudConfig,
  SandboxSetupProgress,
  SandboxSyncStatus,
  PartialToolResult,
  CompactionState,
  CompactionStatus,
  QueuedInput,
  SteerRecord,
  SteerFailReason,
  ImageContent,
  FileAttachmentContent,
} from "../types";
import { applySessionUpdate } from "../utils/session-update";
import { initialPreviewWidth } from "../utils/panel-width";
import type { RightPanelMode } from "../utils/browser-visibility";
import type { ImageSource } from "../components/ImageLightbox";

export type GlobalNoticeType = "info" | "warning" | "error" | "success";
export type GlobalNoticeAction = "open_api_settings";

export interface GlobalNotice {
  id: string;
  message: string;
  messageKey?: string;
  messageValues?: Record<string, string | number>;
  type: GlobalNoticeType;
  actionLabel?: string;
  action?: GlobalNoticeAction;
}

export interface SessionExecutionClock {
  startAt: number | null;
  endAt: number | null;
}

// Unified per-session state that replaces 8 parallel xxxBySession Maps
export interface SessionState {
  historyHydrated: boolean;
  /** Whether older history exists beyond the in-memory window. */
  hasMoreOlder: boolean;
  /** Id of the oldest message in the in-memory window (paging cursor). */
  oldestMessageId: string | null;
  messages: Message[];
  partialByTurn: Record<string, { message: string; thinking: string }>;
  partialMessage: string;
  partialThinking: string;
  pendingTurns: TurnState[];
  activeTurn: TurnState | null;
  executionClock: SessionExecutionClock;
  traceSteps: TraceStep[];
  contextWindow: number;
  compaction: CompactionState;
  inputQueue: QueuedInput[];
  steerRecords: SteerRecord[];
  partialToolResults: Record<string, PartialToolResult>;
  goalStatus?: {
    status:
      | "active"
      | "paused"
      | "complete"
      | "cleared"
      | "blocked"
      | "budget_limited";
    objective?: string;
    iteration?: number;
    tokensUsed?: number;
    tokenBudget?: number;
    timeUsedSeconds?: number;
    timeBudgetSeconds?: number;
    activePeriodStartedAt?: number;
  };
  backgroundAgents: Array<{
    id: string;
    type: string;
    description: string;
    status: "running" | "done";
  }>;
}

// Store window cap. prependOlderMessages allows the window to grow to
// cap + page size before trimming the oldest messages (returning how many
// were trimmed so the render window start can be remapped); trimming on
// every prepend would discard the very page just loaded. Kept in sync
// with the ChatView locals MAX_MEMORY_WINDOW_MESSAGES / LOAD_OLDER_PAGE_SIZE.
const MAX_MEMORY_WINDOW_MESSAGES = 2000;
const MESSAGE_PAGE_SIZE = 1000;

const DEFAULT_SESSION_STATE: SessionState = {
  historyHydrated: false,
  hasMoreOlder: false,
  oldestMessageId: null,
  messages: [],
  partialByTurn: {},
  partialMessage: "",
  partialThinking: "",
  pendingTurns: [],
  activeTurn: null,
  executionClock: { startAt: null, endAt: null },
  traceSteps: [],
  contextWindow: 0,
  compaction: { status: "idle" },
  inputQueue: [],
  steerRecords: [],
  partialToolResults: {},
  backgroundAgents: [],
};

// Helper to immutably update a single session's state within the record
function patchSession(
  states: Record<string, SessionState>,
  sessionId: string,
  updates: Partial<SessionState>,
): Record<string, SessionState> {
  const current = states[sessionId] ?? DEFAULT_SESSION_STATE;
  return {
    ...states,
    [sessionId]: { ...current, ...updates },
  };
}

// Helper to get a session's state with safe defaults
function getSession(
  states: Record<string, SessionState>,
  sessionId: string,
): SessionState {
  return states[sessionId] ?? DEFAULT_SESSION_STATE;
}

export type ActiveView =
  | "chat"
  | "apps"
  | "automation"
  | "vault"
  | "settings"
  | "usage";

interface AppState {
  // Sessions
  sessions: Session[];
  activeSessionId: string | null;

  // Per-session state (messages, partials, turns, traces, etc.)
  sessionStates: Record<string, SessionState>;

  // UI state
  isLoading: boolean;
  /** Pi 扩展 setEditorText 待写入聊天输入框的内容（写入后清空）。 */
  pendingEditorText: string | null;
  sidebarCollapsed: boolean;
  /** 自动折叠前侧栏是否收起；null = 当前没有生效中的自动折叠 */
  sidebarCollapsedBeforePanels: boolean | null;
  sidebarWidth: number;
  contextPanelWidth: number;
  browserWidthManual: boolean;
  activeView: ActiveView;
  settingsTab: string | null;

  rightPanelMode: "files" | "browser" | "preview" | null;
  previewTabs: PreviewTab[];
  activePreviewTab: string | null;
  rightPanelPreviousMode: "files" | "browser" | null;
  previewWidth: number | null;
  /** 预览宽度是否已被用户手动拖拽过；false 时随布局自动重算 */
  previewWidthManual: boolean;
  isReviewOpen: boolean;
  reviewTargetFile: string | null;
  isArtifactPanelOpen: boolean;
  fileBrowserRoot: string | null;

  // Permission
  pendingPermission: PermissionRequest | null;

  // Sudo password
  pendingSudoPassword: SudoPasswordRequest | null;

  // Settings
  settings: Settings;

  // App Config (API settings)
  appConfig: AppConfig | null;
  isConfigured: boolean;
  showConfigModal: boolean;
  setShowLoginModal: (show: boolean) => void;
  showLoginModal: boolean;

  // Cloud auth
  cloudConfig: CloudConfig | null;
  setCloudConfig: (config: CloudConfig | null) => void;
  // Top-up dialog
  topUpOpen: boolean;
  setTopUpOpen: (open: boolean) => void;
  // Cloud — active team
  activeTeamId: string | null;
  setActiveTeamId: (id: string | null) => void;
  activeTeamName: string;
  setActiveTeamName: (name: string) => void;
  // Incremented when skills change (share/delete/publish), triggers tab refresh
  skillRefreshKey: number;
  incrementSkillRefreshKey: () => void;
  hasSeenInitialConfigStatus: boolean;
  globalNotice: GlobalNotice | null;
  /**
   * 扩展命令（插件命令）的名字集合，供渲染层判断行首的 `/word` 是不是命令。
   * 只存扩展命令 —— 内置命令由 utils/reference-tokens.ts 的 BUILTIN_COMMAND_NAMES 自带。
   * 为空时行首的未知 `/word` 退化为纯文本，不会误判。
   */
  knownCommandNames: ReadonlySet<string>;

  // Working directory
  workingDir: string | null;

  // Sandbox setup
  sandboxSetupProgress: SandboxSetupProgress | null;
  isSandboxSetupComplete: boolean;

  // Sandbox sync (per-session)
  sandboxSyncStatus: SandboxSyncStatus | null;

  // System theme (from OS native theme)
  systemDarkMode: boolean;

  // Update
  updateReady: boolean;
  updateVersion: string;

  // Image lightbox
  lightboxImages: ImageSource[];
  lightboxIndex: number;
  lightboxLoading: boolean;
  lightboxSource: "pasted" | "attached" | "message" | null;
  openLightbox: (
    images: ImageSource[],
    index?: number,
    loading?: boolean,
    source?: "pasted" | "attached" | "message",
  ) => void;
  closeLightbox: () => void;

  // Blocking renderer modals that must cover the native browser view
  browserOcclusionIds: ReadonlySet<string>;
  acquireBrowserOcclusion: (id: string) => void;
  releaseBrowserOcclusion: (id: string) => void;

  // Browser fullscreen
  isBrowserFullscreen: boolean;
  browserFullscreenSnapshot: {
    rightPanelMode: "files" | "browser" | null;
    contextPanelWidth: number;
  } | null;
  enterBrowserFullscreen: () => void;
  exitBrowserFullscreen: () => void;

  // Actions
  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  setPendingEditorText: (text: string | null) => void;
  updateSession: (sessionId: string, updates: Partial<Session>) => void;
  removeSession: (sessionId: string) => void;
  removeSessions: (sessionIds: string[]) => void;
  setActiveSession: (sessionId: string | null) => void;

  addMessage: (sessionId: string, message: Message) => void;
  updateMessage: (
    sessionId: string,
    messageId: string,
    updates: Partial<Message>,
  ) => void;
  startExecutionClock: (sessionId: string, startAt: number) => void;
  finishExecutionClock: (sessionId: string, endAt?: number) => void;
  clearExecutionClock: (sessionId: string) => void;
  setGoalStatus: (
    sessionId: string,
    goalStatus: SessionState["goalStatus"],
  ) => void;
  addBackgroundAgent: (
    sessionId: string,
    agent: { id: string; type: string; description: string },
  ) => void;
  updateBackgroundAgentStatus: (
    sessionId: string,
    agentId: string,
    status: "running" | "done",
  ) => void;
  removeBackgroundAgent: (sessionId: string, agentId: string) => void;
  setMessages: (sessionId: string, messages: Message[]) => void;
  setMessagesTail: (
    sessionId: string,
    messages: Message[],
    hasMore: boolean,
  ) => void;
  prependOlderMessages: (
    sessionId: string,
    older: Message[],
    hasMore: boolean,
  ) => number;
  trimMessagesToWindow: (sessionId: string, keepCount: number) => void;
  setPartialMessage: (
    sessionId: string,
    partial: string,
    turnId?: string,
  ) => void;
  clearPartialMessage: (sessionId: string) => void;
  setPartialThinking: (
    sessionId: string,
    delta: string,
    turnId?: string,
  ) => void;
  clearPartialThinking: (sessionId: string) => void;
  activateNextTurn: (
    sessionId: string,
    stepId: string,
    turnId?: string,
  ) => void;
  updateActiveTurnStep: (sessionId: string, stepId: string) => void;
  clearActiveTurn: (sessionId: string, stepId?: string) => void;
  clearPendingTurns: (sessionId: string) => void;
  clearQueuedMessages: (sessionId: string) => void;
  cancelQueuedMessages: (sessionId: string) => void;
  addTraceStep: (sessionId: string, step: TraceStep) => void;
  updateTraceStep: (
    sessionId: string,
    stepId: string,
    updates: Partial<TraceStep>,
  ) => void;
  setTraceSteps: (sessionId: string, steps: TraceStep[]) => void;

  setLoading: (loading: boolean) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setContextPanelWidth: (width: number) => void;
  setActiveView: (view: ActiveView) => void;
  setShowSettings: (show: boolean) => void;
  setShowSchedule: (show: boolean) => void;
  setShowApps: (show: boolean) => void;
  setSettingsTab: (tab: string | null) => void;

  setRightPanelMode: (mode: "files" | "browser" | null) => void;
  openPreview: (tab: PreviewTab) => void;
  closePreviewTab: (path: string) => void;
  closePreviewPanel: () => void;
  setPreviewWidth: (width: number) => void;
  setPreviewWidthManual: (manual: boolean) => void;
  setReviewOpen: (open: boolean) => void;
  setReviewTargetFile: (path: string | null) => void;
  toggleArtifactPanel: () => void;
  setArtifactPanelOpen: (open: boolean) => void;
  toggleFileBrowser: () => void;
  toggleReviewPanel: () => void;
  toggleBrowserPanel: () => void;
  setBrowserWidthManual: (manual: boolean) => void;

  setPendingPermission: (permission: PermissionRequest | null) => void;

  setPendingSudoPassword: (request: SudoPasswordRequest | null) => void;

  setSettings: (updates: Partial<Settings>) => void;
  updateSettings: (updates: Partial<Settings>) => void;

  // Config actions
  setAppConfig: (config: AppConfig | null) => void;
  setIsConfigured: (configured: boolean) => void;
  setShowConfigModal: (show: boolean) => void;
  markInitialConfigStatusSeen: () => void;
  setKnownCommandNames: (names: ReadonlySet<string>) => void;
  setGlobalNotice: (notice: GlobalNotice | null) => void;
  clearGlobalNotice: () => void;

  // Working directory actions
  setWorkingDir: (path: string | null) => void;

  // Sandbox setup actions
  setSandboxSetupProgress: (progress: SandboxSetupProgress | null) => void;
  setSandboxSetupComplete: (complete: boolean) => void;

  // Sandbox sync actions
  setSandboxSyncStatus: (status: SandboxSyncStatus | null) => void;

  // Context window actions
  setSessionContextWindow: (sessionId: string, contextWindow: number) => void;
  setSessionCompaction: (
    sessionId: string,
    status: CompactionStatus,
    estimatedTokens?: number,
  ) => void;
  dismissSessionCompaction: (sessionId: string) => void;
  enqueueInput: (
    sessionId: string,
    text: string,
    images?: ImageContent[],
    files?: FileAttachmentContent[],
  ) => string;
  removeInput: (sessionId: string, id: string) => void;
  addSteerRecord: (
    sessionId: string,
    text: string,
    anchorMessageId?: string,
  ) => string;
  updateSteerRecord: (
    sessionId: string,
    id: string,
    updates: Partial<Pick<SteerRecord, "status" | "reason">>,
  ) => void;
  failPendingSteerRecords: (
    sessionId: string,
    reason: SteerFailReason,
  ) => string[];

  setPartialToolResult: (
    sessionId: string,
    toolCallId: string,
    result: PartialToolResult | null,
  ) => void;

  // System theme actions
  setSystemDarkMode: (dark: boolean) => void;

  // Update actions
  setUpdateReady: (version: string | null) => void;
}

const defaultSettings: Settings = {
  theme: "light",
  themePreset: "graphite",
  uiFontSize: 14,
  defaultTools: [
    "askuserquestion",
    "todowrite",
    "todoread",
    "webfetch",
    "websearch",
    "read",
    "write",
    "edit",
    "list_directory",
    "glob",
    "grep",
  ],
  permissionRules: [
    { tool: "read", action: "allow" },
    { tool: "glob", action: "allow" },
    { tool: "grep", action: "allow" },
    { tool: "write", action: "ask" },
    { tool: "edit", action: "ask" },
    { tool: "bash", action: "ask" },
  ],
  memoryStrategy: "auto",
  maxContextTokens: 180000,
  autoSkillLearning: false,
  telemetryEnabled: true,
};

export const useAppStore = create<AppState>((set) => ({
  // Initial state
  sessions: [],
  activeSessionId: null,
  sessionStates: {},
  isLoading: false,
  pendingEditorText: null,
  sidebarCollapsed: false,
  sidebarCollapsedBeforePanels: null,
  sidebarWidth: 280,
  contextPanelWidth: 288,
  browserWidthManual: false,
  activeView: "chat",
  settingsTab: null,
  rightPanelMode: null as "files" | "browser" | "preview" | null,
  previewTabs: [] as PreviewTab[],
  activePreviewTab: null as string | null,
  rightPanelPreviousMode: null as "files" | "browser" | null,
  previewWidth: null as number | null,
  previewWidthManual: false,
  isReviewOpen: false,
  reviewTargetFile: null,
  isArtifactPanelOpen: false,
  fileBrowserRoot: null,
  pendingPermission: null,
  pendingSudoPassword: null,
  settings: defaultSettings,
  appConfig: null,
  isConfigured: false,
  cloudConfig: null,
  topUpOpen: false,
  activeTeamId: null,
  activeTeamName: "",
  skillRefreshKey: 0,
  showLoginModal: false,
  showConfigModal: false,
  hasSeenInitialConfigStatus: false,
  globalNotice: null,
  knownCommandNames: new Set<string>(),
  workingDir: null,
  sandboxSetupProgress: null,
  isSandboxSetupComplete: false,
  sandboxSyncStatus: null,
  systemDarkMode: false,
  updateReady: false,
  updateVersion: "",
  lightboxImages: [] as ImageSource[],
  lightboxIndex: 0,
  lightboxLoading: false,
  lightboxSource: null as "pasted" | "attached" | "message" | null,
  browserOcclusionIds: new Set<string>(),
  isBrowserFullscreen: false,
  browserFullscreenSnapshot: null as {
    rightPanelMode: "files" | "browser" | null;
    contextPanelWidth: number;
  } | null,

  // Session actions
  setSessions: (sessions) => set({ sessions }),

  setPendingEditorText: (text) => set({ pendingEditorText: text }),

  addSession: (session) =>
    set((state) => ({
      sessions: [session, ...state.sessions],
      sessionStates: {
        ...state.sessionStates,
        [session.id]: { ...DEFAULT_SESSION_STATE, historyHydrated: true },
      },
    })),

  updateSession: (sessionId, updates) =>
    set((state) => ({
      sessions: applySessionUpdate(state.sessions, sessionId, updates),
    })),

  removeSession: (sessionId) =>
    set((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [sessionId]: _, ...restSessionStates } = state.sessionStates;
      return {
        sessions: state.sessions.filter((s) => s.id !== sessionId),
        sessionStates: restSessionStates,
        activeSessionId:
          state.activeSessionId === sessionId ? null : state.activeSessionId,
      };
    }),

  removeSessions: (sessionIds) =>
    set((state) => {
      const idSet = new Set(sessionIds);
      const newSessionStates: Record<string, SessionState> = {};
      for (const key of Object.keys(state.sessionStates)) {
        if (!idSet.has(key)) newSessionStates[key] = state.sessionStates[key];
      }

      return {
        sessions: state.sessions.filter((s) => !idSet.has(s.id)),
        sessionStates: newSessionStates,
        activeSessionId:
          state.activeSessionId && idSet.has(state.activeSessionId)
            ? null
            : state.activeSessionId,
      };
    }),

  setActiveSession: (sessionId) => {
    try {
      if (sessionId) localStorage.setItem("deskwand.lastSessionId", sessionId);
      else localStorage.removeItem("deskwand.lastSessionId");
    } catch {
      /* ignore */
    }
    set((state) => {
      if (sessionId === state.activeSessionId) {
        return { activeSessionId: sessionId };
      }
      if (state.rightPanelMode !== "preview") {
        return { activeSessionId: sessionId };
      }
      return {
        ...clearedPreview(),
        ...sidebarSyncForMode(state, state.rightPanelPreviousMode),
        rightPanelMode: state.rightPanelPreviousMode,
        activeSessionId: sessionId,
      };
    });
  },

  // Message actions
  addMessage: (sessionId, message) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      const messages = ss.messages;
      let updatedMessages = messages;
      let updatedPendingTurns = ss.pendingTurns;

      if (message.role === "user") {
        updatedMessages = [...messages, message];
        updatedPendingTurns = [
          ...ss.pendingTurns,
          {
            turnId: message.turnId || message.id,
            userMessageId: message.id,
            startedAt: Date.now(),
          },
        ];
      } else {
        const activeTurn = ss.activeTurn;
        if (activeTurn?.userMessageId) {
          const anchorIndex = messages.findIndex(
            (item) => item.id === activeTurn.userMessageId,
          );
          if (anchorIndex >= 0) {
            let insertIndex = anchorIndex + 1;
            while (insertIndex < messages.length) {
              if (messages[insertIndex].role === "user") break;
              insertIndex += 1;
            }
            updatedMessages = [
              ...messages.slice(0, insertIndex),
              message,
              ...messages.slice(insertIndex),
            ];
          } else {
            updatedMessages = [...messages, message];
          }
        } else {
          updatedMessages = [...messages, message];
        }
      }

      const shouldClearPartial = message.role === "assistant";
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          messages: updatedMessages,
          pendingTurns: updatedPendingTurns,
          ...(shouldClearPartial
            ? {
                partialByTurn: message.turnId
                  ? Object.fromEntries(
                      Object.entries(ss.partialByTurn).filter(
                        ([key]) => key !== message.turnId,
                      ),
                    )
                  : ss.partialByTurn,
                partialMessage: "",
                partialThinking: "",
                ...(message.tokenUsage
                  ? { compaction: { status: "idle" } }
                  : {}),
              }
            : {}),
        }),
      };
    }),

  updateMessage: (sessionId, messageId, updates) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      const idx = ss.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return {};
      const updatedMessages = ss.messages.map((m) =>
        m.id === messageId ? { ...m, ...updates } : m,
      );
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          messages: updatedMessages,
        }),
      };
    }),

  startExecutionClock: (sessionId, startAt) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, {
        executionClock: { startAt, endAt: null },
      }),
    })),

  finishExecutionClock: (sessionId, endAt) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      if (ss.executionClock.startAt === null) return {};
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          executionClock: {
            startAt: ss.executionClock.startAt,
            endAt: endAt ?? Date.now(),
          },
        }),
      };
    }),

  clearExecutionClock: (sessionId) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, {
        executionClock: { startAt: null, endAt: null },
      }),
    })),

  setGoalStatus: (sessionId, goalStatus) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, {
        goalStatus,
      }),
    })),

  addBackgroundAgent: (sessionId, agent) =>
    set((state) => {
      const current = state.sessionStates[sessionId] ?? DEFAULT_SESSION_STATE;
      // Idempotent: skip if this agent is already tracked
      if (current.backgroundAgents.some((a) => a.id === agent.id)) {
        return {};
      }
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          backgroundAgents: [
            ...current.backgroundAgents,
            { ...agent, status: "running" as const },
          ],
        }),
      };
    }),

  updateBackgroundAgentStatus: (sessionId, agentId, status) =>
    set((state) => {
      const current = state.sessionStates[sessionId] ?? DEFAULT_SESSION_STATE;
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          backgroundAgents: current.backgroundAgents.map((a) =>
            a.id === agentId ? { ...a, status } : a,
          ),
        }),
      };
    }),

  removeBackgroundAgent: (sessionId, agentId) =>
    set((state) => {
      const current = state.sessionStates[sessionId] ?? DEFAULT_SESSION_STATE;
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          backgroundAgents: current.backgroundAgents.filter(
            (a) => a.id !== agentId,
          ),
        }),
      };
    }),

  setMessages: (sessionId, messages) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, {
        messages,
        historyHydrated: true,
      }),
    })),

  setMessagesTail: (sessionId, messages, hasMore) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, {
        messages,
        hasMoreOlder: hasMore,
        oldestMessageId: messages[0]?.id ?? null,
        historyHydrated: true,
      }),
    })),

  prependOlderMessages: (sessionId, older, hasMore) => {
    let trimmedCount = 0;
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      const merged = [...older, ...ss.messages];
      let messages = merged;
      const cap = MAX_MEMORY_WINDOW_MESSAGES + MESSAGE_PAGE_SIZE;
      if (merged.length > cap) {
        trimmedCount = merged.length - MAX_MEMORY_WINDOW_MESSAGES;
        messages = merged.slice(trimmedCount);
      }
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          messages,
          hasMoreOlder: hasMore,
          oldestMessageId: messages[0]?.id ?? ss.oldestMessageId,
          historyHydrated: true,
        }),
      };
    });
    return trimmedCount;
  },

  trimMessagesToWindow: (sessionId, keepCount) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      if (ss.messages.length <= keepCount) return {};
      const messages = ss.messages.slice(-keepCount);
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          messages,
          oldestMessageId: messages[0]?.id ?? null,
        }),
      };
    }),

  setPartialMessage: (sessionId, partial, turnId) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      const key = turnId || ss.activeTurn?.turnId || "default";
      const current = ss.partialByTurn[key] || { message: "", thinking: "" };
      const partialByTurn = {
        ...ss.partialByTurn,
        [key]: {
          ...current,
          message: partial ? current.message + partial : "",
        },
      };
      const activeKey = ss.activeTurn?.turnId || key;
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          partialByTurn,
          partialMessage: partialByTurn[activeKey]?.message || "",
        }),
      };
    }),

  clearPartialMessage: (sessionId) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, {
        partialMessage: "",
      }),
    })),

  setPartialThinking: (sessionId, delta, turnId) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      const key = turnId || ss.activeTurn?.turnId || "default";
      const current = ss.partialByTurn[key] || { message: "", thinking: "" };
      const partialByTurn = {
        ...ss.partialByTurn,
        [key]: { ...current, thinking: delta ? current.thinking + delta : "" },
      };
      const activeKey = ss.activeTurn?.turnId || key;
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          partialByTurn,
          partialThinking: partialByTurn[activeKey]?.thinking || "",
        }),
      };
    }),

  clearPartialThinking: (sessionId) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, {
        partialThinking: "",
      }),
    })),

  activateNextTurn: (sessionId, stepId, turnId) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      if (ss.pendingTurns.length === 0) {
        return {
          sessionStates: patchSession(state.sessionStates, sessionId, {
            activeTurn: null,
            partialMessage: "",
            partialThinking: "",
          }),
        };
      }

      const nextTurnIndex = turnId
        ? ss.pendingTurns.findIndex((turn) => turn.turnId === turnId)
        : 0;
      if (nextTurnIndex === -1) return {};
      const nextTurn = ss.pendingTurns[nextTurnIndex];
      const rest = ss.pendingTurns.filter(
        (_, index) => index !== nextTurnIndex,
      );
      const updatedMessages = ss.messages.map((message) =>
        message.id === nextTurn.userMessageId
          ? { ...message, localStatus: undefined }
          : message,
      );

      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          messages: updatedMessages,
          pendingTurns: rest,
          activeTurn: { ...nextTurn, stepId },
          partialMessage: ss.partialByTurn[nextTurn.turnId]?.message || "",
          partialThinking: ss.partialByTurn[nextTurn.turnId]?.thinking || "",
        }),
      };
    }),

  updateActiveTurnStep: (sessionId, stepId) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      if (!ss.activeTurn || ss.activeTurn.stepId === stepId) return {};
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          activeTurn: { ...ss.activeTurn, stepId },
          partialMessage: ss.partialByTurn[ss.activeTurn.turnId]?.message || "",
          partialThinking:
            ss.partialByTurn[ss.activeTurn.turnId]?.thinking || "",
        }),
      };
    }),

  clearActiveTurn: (sessionId, stepId) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      if (!ss.activeTurn) return {};
      if (stepId && ss.activeTurn.stepId !== stepId) return {};
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          activeTurn: null,
          partialMessage: "",
          partialThinking: "",
        }),
      };
    }),

  clearPendingTurns: (sessionId) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, {
        pendingTurns: [],
      }),
    })),

  clearQueuedMessages: (sessionId) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      let hasQueued = false;
      const updatedMessages = ss.messages.map((message) => {
        if (message.localStatus === "queued") {
          hasQueued = true;
          return { ...message, localStatus: undefined };
        }
        return message;
      });
      // Also remove any queued message IDs from pendingTurns
      const queuedIds = new Set(
        ss.messages.filter((m) => m.localStatus === "queued").map((m) => m.id),
      );
      const updatedPendingTurns = ss.pendingTurns.filter(
        (turn) => !queuedIds.has(turn.userMessageId),
      );
      if (!hasQueued) return {};
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          messages: updatedMessages,
          pendingTurns: updatedPendingTurns,
        }),
      };
    }),

  cancelQueuedMessages: (sessionId) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      const pendingIds = new Set(
        ss.pendingTurns.map((turn) => turn.userMessageId),
      );
      if (pendingIds.size === 0) return {};
      const updatedMessages = ss.messages.map((message) =>
        pendingIds.has(message.id)
          ? { ...message, localStatus: "cancelled" as const }
          : message,
      );
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          messages: updatedMessages,
          pendingTurns: [],
        }),
      };
    }),

  addTraceStep: (sessionId, step) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          traceSteps: [...ss.traceSteps, step],
        }),
      };
    }),

  updateTraceStep: (sessionId, stepId, updates) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          traceSteps: ss.traceSteps.map((step) =>
            step.id === stepId ? { ...step, ...updates } : step,
          ),
        }),
      };
    }),

  setTraceSteps: (sessionId, steps) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, {
        traceSteps: steps,
        historyHydrated: true,
      }),
    })),

  // UI actions
  setLoading: (loading) => set({ isLoading: loading }),
  toggleSidebar: () =>
    set((state) => ({
      sidebarCollapsed: !state.sidebarCollapsed,
      sidebarCollapsedBeforePanels: null,
    })),
  setSidebarCollapsed: (collapsed) =>
    set({ sidebarCollapsed: collapsed, sidebarCollapsedBeforePanels: null }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setContextPanelWidth: (width) => set({ contextPanelWidth: width }),
  setActiveView: (activeView) => set({ activeView }),
  setShowSettings: (show) => set({ activeView: show ? "settings" : "chat" }),
  setShowSchedule: (show) => set({ activeView: show ? "automation" : "chat" }),
  setShowApps: (show) => set({ activeView: show ? "apps" : "chat" }),
  setSettingsTab: (tab) => set({ settingsTab: tab }),
  setRightPanelMode: (mode) =>
    set((state) => ({
      ...clearedPreview(),
      ...sidebarSyncForMode(state, mode),
      rightPanelMode: mode,
    })),
  setReviewOpen: (open) => set({ isReviewOpen: open }),
  setReviewTargetFile: (path) => set({ reviewTargetFile: path }),
  toggleArtifactPanel: () =>
    set((state) => ({ isArtifactPanelOpen: !state.isArtifactPanelOpen })),
  setArtifactPanelOpen: (open) => set({ isArtifactPanelOpen: open }),
  toggleFileBrowser: () =>
    set((state) => {
      const next = state.rightPanelMode === "files" ? null : "files";
      return {
        ...clearedPreview(),
        ...sidebarSyncForMode(state, next),
        rightPanelMode: next,
      };
    }),
  toggleReviewPanel: () =>
    set((state) => ({ isReviewOpen: !state.isReviewOpen })),
  toggleBrowserPanel: () =>
    set((state) => {
      if (state.rightPanelMode === "browser") {
        return {
          ...clearedPreview(),
          ...sidebarSyncForMode(state, null),
          rightPanelMode: null,
        };
      }
      return {
        ...clearedPreview(),
        ...sidebarSyncForMode(state, "browser"),
        rightPanelMode: "browser",
        browserWidthManual: false,
      };
    }),
  setBrowserWidthManual: (manual) => set({ browserWidthManual: manual }),

  openPreview: (tab) =>
    set((state) => {
      const existing = state.previewTabs.find((item) => item.path === tab.path);
      const sidebarPatch = sidebarSyncForMode(state, "preview");
      const collapsedAfterPatch =
        sidebarPatch.sidebarCollapsed ?? state.sidebarCollapsed;
      return {
        ...sidebarPatch,
        // 已在标签里的文件只聚焦，不改写标签文案；但「播放」这类请求要生效。
        previewTabs: existing
          ? state.previewTabs.map((item) =>
              item.path === tab.path && tab.autoPlay
                ? { ...item, autoPlay: true }
                : item,
            )
          : [...state.previewTabs, tab],
        activePreviewTab: tab.path,
        rightPanelMode: "preview" as const,
        rightPanelPreviousMode:
          state.rightPanelMode === "preview"
            ? state.rightPanelPreviousMode
            : state.rightPanelMode,
        previewWidth:
          state.previewWidthManual && state.previewWidth !== null
            ? state.previewWidth
            : initialPreviewWidth(
                window.innerWidth,
                collapsedAfterPatch,
                state.sidebarWidth,
              ),
      };
    }),

  closePreviewTab: (path) =>
    set((state) => {
      const index = state.previewTabs.findIndex((item) => item.path === path);
      if (index === -1) return {};
      const remaining = state.previewTabs.filter((item) => item.path !== path);
      if (remaining.length === 0) {
        return {
          ...clearedPreview(),
          ...sidebarSyncForMode(state, state.rightPanelPreviousMode),
          rightPanelMode: state.rightPanelPreviousMode,
        };
      }
      if (state.activePreviewTab !== path) {
        return { previewTabs: remaining };
      }
      const nextIndex = Math.min(index, remaining.length - 1);
      return {
        previewTabs: remaining,
        activePreviewTab: remaining[nextIndex].path,
      };
    }),

  closePreviewPanel: () =>
    set((state) => ({
      ...clearedPreview(),
      ...sidebarSyncForMode(state, state.rightPanelPreviousMode),
      rightPanelMode: state.rightPanelPreviousMode,
    })),

  setPreviewWidth: (width) => set({ previewWidth: width }),
  setPreviewWidthManual: (manual) => set({ previewWidthManual: manual }),

  // Permission actions
  setPendingPermission: (permission) => set({ pendingPermission: permission }),

  // Sudo password actions
  setPendingSudoPassword: (request) => set({ pendingSudoPassword: request }),

  // Settings actions
  setSettings: (updates) =>
    set((state) => ({
      settings: { ...state.settings, ...updates },
    })),
  updateSettings: (updates) => {
    if (typeof window !== "undefined" && window.electronAPI) {
      window.electronAPI.send({
        type: "settings.update",
        payload: updates as Record<string, unknown>,
      });
    }
    set((state) => ({
      settings: { ...state.settings, ...updates },
    }));
  },

  // Config actions
  setAppConfig: (config) => set({ appConfig: config }),
  setIsConfigured: (configured) => set({ isConfigured: configured }),
  setActiveTeamId: (id) => set({ activeTeamId: id }),
  setActiveTeamName: (name) => set({ activeTeamName: name }),
  incrementSkillRefreshKey: () =>
    set((s) => ({ skillRefreshKey: s.skillRefreshKey + 1 })),

  setCloudConfig: (config) => {
    set({ cloudConfig: config });
    try {
      if (config) {
        localStorage.setItem("deskwand.cloud", JSON.stringify(config));
      } else {
        localStorage.removeItem("deskwand.cloud");
      }
    } catch {
      /* localStorage unavailable */
    }
  },
  setTopUpOpen: (open: boolean) => set({ topUpOpen: open }),
  setShowLoginModal: (show) => set({ showLoginModal: show }),
  setShowConfigModal: (show) => set({ showConfigModal: show }),
  markInitialConfigStatusSeen: () => set({ hasSeenInitialConfigStatus: true }),
  setKnownCommandNames: (names) => set({ knownCommandNames: names }),
  setGlobalNotice: (notice) => set({ globalNotice: notice }),
  clearGlobalNotice: () => set({ globalNotice: null }),

  // Working directory actions
  setWorkingDir: (path) => set({ workingDir: path }),

  // Sandbox setup actions
  setSandboxSetupProgress: (progress) =>
    set({ sandboxSetupProgress: progress }),
  setSandboxSetupComplete: (complete) =>
    set({ isSandboxSetupComplete: complete }),

  // Sandbox sync actions
  setSandboxSyncStatus: (status) => set({ sandboxSyncStatus: status }),

  // Context window actions
  setSessionContextWindow: (sessionId, contextWindow) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, {
        contextWindow,
      }),
    })),

  setSessionCompaction: (sessionId, status, estimatedTokens) =>
    set((state) => {
      const current = getSession(state.sessionStates, sessionId).compaction;
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          compaction: {
            status,
            ...(status === "success"
              ? { estimatedTokens: estimatedTokens ?? null }
              : current.estimatedTokens !== undefined
                ? { estimatedTokens: current.estimatedTokens }
                : {}),
          },
        }),
      };
    }),

  dismissSessionCompaction: (sessionId) =>
    set((state) => {
      const current = getSession(state.sessionStates, sessionId).compaction;
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          compaction: { ...current, status: "idle" },
        }),
      };
    }),

  enqueueInput: (sessionId, text, images, files) => {
    const id = `queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ts = Date.now();
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          inputQueue: [...ss.inputQueue, { id, text, ts, images, files }],
        }),
      };
    });
    return id;
  },

  removeInput: (sessionId, id) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          inputQueue: ss.inputQueue.filter((item) => item.id !== id),
        }),
      };
    }),

  addSteerRecord: (sessionId, text, anchorMessageId) => {
    const id = `steer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ts = Date.now();
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          steerRecords: [
            ...ss.steerRecords,
            { id, text, status: "injecting" as const, ts, anchorMessageId },
          ],
        }),
      };
    });
    return id;
  },

  updateSteerRecord: (sessionId, id, updates) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      const target = ss.steerRecords.find((r) => r.id === id);
      if (!target) return {};
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          steerRecords: ss.steerRecords.map((r) =>
            r.id === id ? { ...r, ...updates } : r,
          ),
        }),
      };
    }),

  failPendingSteerRecords: (sessionId, reason) => {
    const failedIds: string[] = [];
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      let changed = false;
      const records = ss.steerRecords.map((r) => {
        if (r.status === "injecting") {
          changed = true;
          failedIds.push(r.id);
          return { ...r, status: "failed" as const, reason };
        }
        return r;
      });
      return changed
        ? {
            sessionStates: patchSession(state.sessionStates, sessionId, {
              steerRecords: records,
            }),
          }
        : {};
    });
    return failedIds;
  },

  setPartialToolResult: (sessionId, toolCallId, result) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      const current = ss.partialToolResults;
      if (result === null) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [toolCallId]: _, ...rest } = current;
        return {
          sessionStates: patchSession(state.sessionStates, sessionId, {
            partialToolResults: rest,
          }),
        };
      }
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          partialToolResults: { ...current, [toolCallId]: result },
        }),
      };
    }),

  // System theme actions
  setSystemDarkMode: (dark) => set({ systemDarkMode: dark }),

  // Update actions
  setUpdateReady: (version) =>
    set({
      updateReady: version !== null,
      updateVersion: version || "",
    }),

  // Image lightbox actions
  openLightbox: (images, index = 0, loading = false, source) =>
    set({
      lightboxImages: images,
      lightboxIndex: index,
      lightboxLoading: loading,
      lightboxSource: source ?? null,
    }),
  closeLightbox: () =>
    set({
      lightboxImages: [],
      lightboxIndex: 0,
      lightboxLoading: false,
      lightboxSource: null,
    }),

  acquireBrowserOcclusion: (id) =>
    set((state) => {
      if (state.browserOcclusionIds.has(id)) return state;
      const browserOcclusionIds = new Set(state.browserOcclusionIds);
      browserOcclusionIds.add(id);
      return { browserOcclusionIds };
    }),

  releaseBrowserOcclusion: (id) =>
    set((state) => {
      if (!state.browserOcclusionIds.has(id)) return state;
      const browserOcclusionIds = new Set(state.browserOcclusionIds);
      browserOcclusionIds.delete(id);
      return { browserOcclusionIds };
    }),

  // Browser fullscreen actions
  enterBrowserFullscreen: () =>
    set((state) => ({
      browserFullscreenSnapshot: {
        rightPanelMode:
          state.rightPanelMode === "preview" ? null : state.rightPanelMode,
        contextPanelWidth: state.contextPanelWidth,
      },
      isBrowserFullscreen: true,
      ...clearedPreview(),
    })),

  exitBrowserFullscreen: () =>
    set((state) => {
      const snapshot = state.browserFullscreenSnapshot;
      if (!snapshot) {
        return { isBrowserFullscreen: false, browserFullscreenSnapshot: null };
      }
      return {
        isBrowserFullscreen: false,
        browserFullscreenSnapshot: null,
        ...sidebarSyncForMode(state, snapshot.rightPanelMode),
        rightPanelMode: snapshot.rightPanelMode,
        contextPanelWidth: snapshot.contextPanelWidth,
      };
    }),
}));

// Expose helpers for nav-server (CLI-driven UI navigation via executeJavaScript)
if (typeof window !== "undefined") {
  const w = window as unknown as Record<string, unknown>;

  w.__getNavStatus = () => {
    const s = useAppStore.getState();
    return {
      activeView: s.activeView,
      showSettings: s.activeView === "settings",
      activeSessionId: s.activeSessionId || null,
      sessionCount: (s.sessions || []).length,
    };
  };

  w.__navigate = async (page: string, tab?: string, sessionId?: string) => {
    const store = useAppStore.getState();
    if (page === "welcome") {
      store.setShowSettings(false);
      store.setActiveSession(null);
    } else if (page === "settings") {
      store.setSettingsTab(tab || "general");
      store.setShowSettings(true);
    } else if (page === "session") {
      if (!sessionId || typeof sessionId !== "string") return false;
      const exists = store.sessions.some((s) => s.id === sessionId);
      if (!exists) return false;
      store.setShowSettings(false);
      const hasHydratedState =
        store.sessionStates[sessionId]?.historyHydrated === true;
      if (
        !hasHydratedState &&
        typeof window.electronAPI?.invoke === "function"
      ) {
        try {
          const [page, traceSteps] = await Promise.all([
            window.electronAPI.invoke({
              type: "session.getMessagesPage",
              payload: { sessionId, beforeId: null, limit: 1000 },
            }),
            window.electronAPI.invoke({
              type: "session.getTraceSteps",
              payload: { sessionId },
            }),
          ]);
          const pageResult = page as {
            messages?: unknown;
            hasMore?: unknown;
          } | null;
          store.setMessagesTail(
            sessionId,
            Array.isArray(pageResult?.messages) ? pageResult.messages : [],
            Boolean(pageResult?.hasMore),
          );
          store.setTraceSteps(
            sessionId,
            Array.isArray(traceSteps) ? traceSteps : [],
          );
        } catch {
          store.setMessagesTail(sessionId, [], false);
          store.setTraceSteps(sessionId, []);
        }
      }
      store.setActiveSession(sessionId);
    }
    return true;
  };
}

// 预览面板：右侧槽位的第三种模式。
/** 预览标签，`path` 同时作为标签 id。 */
export interface PreviewTab {
  path: string;
  name: string;
  autoPlay?: boolean;
}

/** 所有「离开预览」的路径共用；少清一个字段就会留下幽灵标签。 */
const clearedPreview = () => ({
  previewTabs: [] as PreviewTab[],
  activePreviewTab: null as string | null,
  rightPanelPreviousMode: null as "files" | "browser" | null,
});

const PANEL_MODES: readonly RightPanelMode[] = ["preview", "browser"];
const isPanelMode = (mode: RightPanelMode) => PANEL_MODES.includes(mode);

/** 侧栏同步补丁：只可能写这两个字段。 */
type SidebarSyncPatch = Partial<
  Pick<AppState, "sidebarCollapsed" | "sidebarCollapsedBeforePanels">
>;

/**
 * 右侧槽位模式变化时同步侧栏：
 * - 从「非面板」进入 preview/browser：自动收起并记快照
 * - 从 preview/browser 离开到「非面板」：若快照非空则还原
 * - 面板家族内部切换（preview↔browser）与「非面板 ↔ 非面板」：一律不动
 */
const sidebarSyncForMode = (
  state: Pick<
    AppState,
    "rightPanelMode" | "sidebarCollapsed" | "sidebarCollapsedBeforePanels"
  >,
  nextMode: RightPanelMode,
): SidebarSyncPatch => {
  const fromPanel = isPanelMode(state.rightPanelMode);
  const toPanel = isPanelMode(nextMode);
  if (!fromPanel && toPanel) {
    return {
      sidebarCollapsed: true,
      sidebarCollapsedBeforePanels: state.sidebarCollapsed,
    };
  }
  if (fromPanel && !toPanel && state.sidebarCollapsedBeforePanels !== null) {
    return {
      sidebarCollapsed: state.sidebarCollapsedBeforePanels,
      sidebarCollapsedBeforePanels: null,
    };
  }
  return {};
};
