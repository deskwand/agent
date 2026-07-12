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
} from "../types";
import { applySessionUpdate } from "../utils/session-update";

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
  messages: Message[];
  partialByTurn: Record<string, { message: string; thinking: string }>;
  partialMessage: string;
  partialThinking: string;
  pendingTurns: TurnState[];
  activeTurn: TurnState | null;
  executionClock: SessionExecutionClock;
  traceSteps: TraceStep[];
  contextWindow: number;
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
  };
}

const DEFAULT_SESSION_STATE: SessionState = {
  historyHydrated: false,
  messages: [],
  partialByTurn: {},
  partialMessage: "",
  partialThinking: "",
  pendingTurns: [],
  activeTurn: null,
  executionClock: { startAt: null, endAt: null },
  traceSteps: [],
  contextWindow: 0,
  partialToolResults: {},
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

interface AppState {
  // Sessions
  sessions: Session[];
  activeSessionId: string | null;

  // Per-session state (messages, partials, turns, traces, etc.)
  sessionStates: Record<string, SessionState>;

  // UI state
  isLoading: boolean;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  contextPanelWidth: number;
  showSettings: boolean;
  showSchedule: boolean;
  showMarketplace: boolean;
  settingsTab: string | null;

  rightPanelMode: "files" | "browser" | null;
  isReviewOpen: boolean;
  reviewTargetFile: string | null;
  isArtifactPanelOpen: boolean;
  fileBrowserRoot: string | null;
  gitChangeCount: number;

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

  // Working directory
  workingDir: string | null;

  // Sandbox setup
  sandboxSetupProgress: SandboxSetupProgress | null;
  isSandboxSetupComplete: boolean;

  // Sandbox sync (per-session)
  sandboxSyncStatus: SandboxSyncStatus | null;

  // Task slots — running/completed sessions pinned above the sidebar list
  taskSlots: TaskSlot[];

  // System theme (from OS native theme)
  systemDarkMode: boolean;

  // Update
  updateReady: boolean;
  updateVersion: string;

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
  setMessages: (sessionId: string, messages: Message[]) => void;
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
  setShowSettings: (show: boolean) => void;
  setShowSchedule: (show: boolean) => void;
  setShowMarketplace: (show: boolean) => void;
  setSettingsTab: (tab: string | null) => void;

  setRightPanelMode: (mode: "files" | "browser" | null) => void;
  setReviewOpen: (open: boolean) => void;
  setReviewTargetFile: (path: string | null) => void;
  toggleArtifactPanel: () => void;
  setArtifactPanelOpen: (open: boolean) => void;
  toggleFileBrowser: () => void;
  toggleReviewPanel: () => void;
  toggleBrowserPanel: () => void;
  setGitChangeCount: (count: number) => void;

  setPendingPermission: (permission: PermissionRequest | null) => void;

  setPendingSudoPassword: (request: SudoPasswordRequest | null) => void;

  setSettings: (updates: Partial<Settings>) => void;
  updateSettings: (updates: Partial<Settings>) => void;

  // Config actions
  setAppConfig: (config: AppConfig | null) => void;
  setIsConfigured: (configured: boolean) => void;
  setShowConfigModal: (show: boolean) => void;
  markInitialConfigStatusSeen: () => void;
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

  setPartialToolResult: (
    sessionId: string,
    toolCallId: string,
    result: PartialToolResult | null,
  ) => void;

  // Task slot actions
  setTaskSlots: (slots: TaskSlot[]) => void;
  removeTaskSlot: (sessionId: string) => void;

  // System theme actions
  setSystemDarkMode: (dark: boolean) => void;

  // Update actions
  setUpdateReady: (version: string | null) => void;
}

const defaultSettings: Settings = {
  theme: "light",
  themePreset: "graphite",
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
  autoSkillLearning: true,
};

export interface TaskSlot {
  sessionId: string;
  completed: boolean;
}

const TASK_SLOTS_KEY = "deskwand.taskSlots";

function isTaskSlot(s: unknown): s is TaskSlot {
  return (
    s !== null &&
    typeof s === "object" &&
    typeof (s as Record<string, unknown>).sessionId === "string" &&
    typeof (s as Record<string, unknown>).completed === "boolean"
  );
}

function loadTaskSlots(): TaskSlot[] {
  try {
    const raw = localStorage.getItem(TASK_SLOTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTaskSlot);
  } catch {
    return [];
  }
}

function persistTaskSlots(slots: TaskSlot[]): void {
  try {
    const next = JSON.stringify(slots);
    if (localStorage.getItem(TASK_SLOTS_KEY) === next) return;
    localStorage.setItem(TASK_SLOTS_KEY, next);
  } catch {
    /* ignore */
  }
}

// NOTE: TaskSlot helpers above MUST stay before create(). loadTaskSlots() is
// called synchronously during store init — if TASK_SLOTS_KEY were below it
// would be in the Temporal Dead Zone and always return [].
export const useAppStore = create<AppState>((set) => ({
  // Initial state
  sessions: [],
  activeSessionId: null,
  sessionStates: {},
  isLoading: false,
  sidebarCollapsed: false,
  sidebarWidth: 280,
  contextPanelWidth: 288,
  showSettings: false,
  showSchedule: false,
  showMarketplace: false,
  settingsTab: null,
  rightPanelMode: null as "files" | "browser" | null,
  isReviewOpen: false,
  reviewTargetFile: null,
  isArtifactPanelOpen: false,
  fileBrowserRoot: null,
  gitChangeCount: 0,
  pendingPermission: null,
  pendingSudoPassword: null,
  settings: defaultSettings,
  appConfig: null,
  isConfigured: false,
  cloudConfig: null,
  activeTeamId: null,
  activeTeamName: "",
  skillRefreshKey: 0,
  showLoginModal: false,
  showConfigModal: false,
  hasSeenInitialConfigStatus: false,
  globalNotice: null,
  workingDir: null,
  sandboxSetupProgress: null,
  isSandboxSetupComplete: false,
  sandboxSyncStatus: null,
  taskSlots: loadTaskSlots(),
  systemDarkMode: false,
  updateReady: false,
  updateVersion: '',
  isBrowserFullscreen: false,
  browserFullscreenSnapshot: null as {
    rightPanelMode: "files" | "browser" | null;
    contextPanelWidth: number;
  } | null,

  // Session actions
  setSessions: (sessions) => set({ sessions }),

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
    set({ activeSessionId: sessionId });
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

  setMessages: (sessionId, messages) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, {
        messages,
        historyHydrated: true,
      }),
    })),

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
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setContextPanelWidth: (width) => set({ contextPanelWidth: width }),
  setShowSettings: (show) => set({ showSettings: show }),
  setShowSchedule: (show) => set({ showSchedule: show }),
  setShowMarketplace: (show) => set({ showMarketplace: show }),
  setSettingsTab: (tab) => set({ settingsTab: tab }),
  setRightPanelMode: (mode) => set({ rightPanelMode: mode }),
  setReviewOpen: (open) => set({ isReviewOpen: open }),
  setReviewTargetFile: (path) => set({ reviewTargetFile: path }),
  toggleArtifactPanel: () =>
    set((state) => ({ isArtifactPanelOpen: !state.isArtifactPanelOpen })),
  setArtifactPanelOpen: (open) => set({ isArtifactPanelOpen: open }),
  toggleFileBrowser: () =>
    set((state) => {
      if (state.rightPanelMode === "files") {
        return { rightPanelMode: null };
      }
      return { rightPanelMode: "files" };
    }),
  toggleReviewPanel: () =>
    set((state) => ({ isReviewOpen: !state.isReviewOpen })),
  toggleBrowserPanel: () =>
    set((state) => {
      if (state.rightPanelMode === "browser") {
        return { rightPanelMode: null };
      }
      return { rightPanelMode: "browser" };
    }),
  setGitChangeCount: (count) => set({ gitChangeCount: count }),

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
  setShowLoginModal: (show) => set({ showLoginModal: show }),
  setShowConfigModal: (show) => set({ showConfigModal: show }),
  markInitialConfigStatusSeen: () => set({ hasSeenInitialConfigStatus: true }),
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

  // Task slot actions
  setTaskSlots: (slots) => {
    persistTaskSlots(slots);
    set({ taskSlots: slots });
  },
  removeTaskSlot: (sessionId) =>
    set((state) => {
      const next = state.taskSlots.filter((s) => s.sessionId !== sessionId);
      persistTaskSlots(next);
      return { taskSlots: next };
    }),

  // Context window actions
  setSessionContextWindow: (sessionId, contextWindow) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, {
        contextWindow,
      }),
    })),

  setPartialToolResult: (sessionId, toolCallId, result) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      const current = ss.partialToolResults;
      if (result === null) {
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
      updateVersion: version || '',
    }),

  // Browser fullscreen actions
  enterBrowserFullscreen: () =>
    set((state) => ({
      browserFullscreenSnapshot: {
        rightPanelMode: state.rightPanelMode,
        contextPanelWidth: state.contextPanelWidth,
      },
      isBrowserFullscreen: true,
    })),

  exitBrowserFullscreen: () =>
    set((state) => {
      const snapshot = state.browserFullscreenSnapshot;
      return {
        isBrowserFullscreen: false,
        browserFullscreenSnapshot: null,
        ...(snapshot
          ? {
              rightPanelMode: snapshot.rightPanelMode,
              contextPanelWidth: snapshot.contextPanelWidth,
            }
          : {}),
      };
    }),
}));

// Expose helpers for nav-server (CLI-driven UI navigation via executeJavaScript)
if (typeof window !== "undefined") {
  const w = window as unknown as Record<string, unknown>;

  w.__getNavStatus = () => {
    const s = useAppStore.getState();
    return {
      showSettings: !!s.showSettings,
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
          const [messages, traceSteps] = await Promise.all([
            window.electronAPI.invoke({
              type: "session.getMessages",
              payload: { sessionId },
            }),
            window.electronAPI.invoke({
              type: "session.getTraceSteps",
              payload: { sessionId },
            }),
          ]);
          store.setMessages(sessionId, Array.isArray(messages) ? messages : []);
          store.setTraceSteps(
            sessionId,
            Array.isArray(traceSteps) ? traceSteps : [],
          );
        } catch {
          store.setMessages(sessionId, []);
          store.setTraceSteps(sessionId, []);
        }
      }
      store.setActiveSession(sessionId);
    }
    return true;
  };
}
