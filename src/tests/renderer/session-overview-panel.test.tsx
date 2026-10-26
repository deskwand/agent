// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
    i18n: { language: "en" },
  }),
}));

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({ isElectron: false }),
}));

import { SessionOverviewPanel } from "../../renderer/components/overview/SessionOverviewPanel";
import { useAppStore } from "../../renderer/store";
import { resetRepoSummaryCacheForTests } from "../../renderer/hooks/use-repo-summary";
import type { Session } from "../../renderer/types";
import type { RepoSummary } from "../../shared/repo-summary";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function makeSession(id: string, cwd?: string): Session {
  return {
    id,
    title: id,
    status: "idle",
    cwd,
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function mockRepo(summary: RepoSummary) {
  window.electronAPI = {
    git: { getRepoSummary: vi.fn(async () => summary) },
  } as unknown as typeof window.electronAPI;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetRepoSummaryCacheForTests();
  useAppStore.setState(useAppStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("SessionOverviewPanel", () => {
  it("shows the folder, branch and context usage for a repo session", async () => {
    mockRepo({
      isRepo: true,
      branch: "feature/overview",
      additions: 12,
      deletions: 3,
      changedFiles: 2,
      untracked: 1,
    });
    useAppStore.setState({
      activeSessionId: "s1",
      sessions: [makeSession("s1", "/Users/me/src/voice")],
      sessionStates: {
        s1: {
          historyHydrated: true,
          hasMoreOlder: false,
          oldestMessageId: null,
          messages: [
            {
              id: "m1",
              sessionId: "s1",
              role: "assistant",
              timestamp: 1,
              content: [],
              tokenUsage: { input: 0, output: 0, totalPromptInput: 49000 },
            },
          ],
          partialByTurn: {},
          partialMessage: "",
          partialThinking: "",
          pendingTurns: [],
          activeTurn: null,
          executionClock: { startAt: null, endAt: null },
          traceSteps: [],
          contextWindow: 100000,
          compaction: { status: "idle" },
          retry: { active: false, attempt: 0 },
          inputQueue: [],
          steerRecords: [],
          partialToolResults: {},
          backgroundAgents: [],
          subagentActivities: {},
        },
      },
    } as never);

    await act(async () => {
      root.render(<SessionOverviewPanel visible />);
    });
    await flush();

    const text = container.textContent ?? "";
    expect(text).toContain("voice");
    expect(text).toContain("feature/overview");
    expect(text).toContain("49%");
    expect(text).toContain("overview.context.used:");
  });

  it("keeps working for a session without a cwd and without git", async () => {
    useAppStore.setState({
      activeSessionId: "s2",
      sessions: [makeSession("s2", undefined)],
    });

    await act(async () => {
      root.render(<SessionOverviewPanel visible />);
    });
    await flush();

    const text = container.textContent ?? "";
    expect(text).toContain("overview.env.noFolder");
    expect(text).not.toContain("feature/overview");
  });

  it("closes itself through the header button", async () => {
    useAppStore.setState({
      activeSessionId: "s3",
      sessions: [makeSession("s3", "/repo")],
    });
    useAppStore.getState().toggleOverview();

    await act(async () => {
      root.render(<SessionOverviewPanel visible />);
    });

    const close = container.querySelector<HTMLButtonElement>(
      'button[aria-label="overview.close"]',
    );
    expect(close).not.toBeNull();
    await act(async () => close?.click());

    expect(useAppStore.getState().rightPanelMode).toBeNull();
  });
});
