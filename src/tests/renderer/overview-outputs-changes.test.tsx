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

const openArtifact = vi.fn();
vi.mock("../../renderer/hooks/use-open-artifact", () => ({
  useOpenArtifact: () => ({ openArtifact, canOpenPath: true }),
}));

import { OutputsSection } from "../../renderer/components/overview/OutputsSection";
import { ChangesSection } from "../../renderer/components/overview/ChangesSection";
import { useAppStore } from "../../renderer/store";
import type { RepoSummaryResult } from "../../renderer/hooks/use-repo-summary";
import type { TraceStep } from "../../renderer/types";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function writeStep(index: number): TraceStep {
  return {
    id: `write-${index}`,
    type: "tool_call",
    status: "completed",
    title: "Write",
    toolName: "Write",
    toolOutput: `File created successfully at: /repo/out/report-${index}.md`,
    timestamp: index,
  };
}

function seedSteps(steps: TraceStep[]): void {
  useAppStore.setState({
    activeSessionId: "s1",
    sessions: [
      {
        id: "s1",
        title: "s1",
        status: "idle",
        cwd: "/repo",
        mountedPaths: [],
        allowedTools: [],
        memoryEnabled: false,
        isProjectMode: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    sessionStates: {
      s1: {
        historyHydrated: true,
        hasMoreOlder: false,
        oldestMessageId: null,
        messages: [],
        partialByTurn: {},
        partialMessage: "",
        partialThinking: "",
        pendingTurns: [],
        activeTurn: null,
        executionClock: { startAt: null, endAt: null },
        traceSteps: steps,
        contextWindow: 0,
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
}

function repoResult(partial: Partial<RepoSummaryResult>): RepoSummaryResult {
  return {
    summary: null,
    isLoading: false,
    error: null,
    refresh: () => {},
    ...partial,
  };
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  openArtifact.mockReset();
});

describe("OutputsSection", () => {
  it("shows the five latest artifacts and expands the rest", async () => {
    seedSteps([1, 2, 3, 4, 5, 6, 7].map(writeStep));

    await act(async () => {
      root.render(<OutputsSection />);
    });

    const text = container.textContent ?? "";
    expect(text).toContain("report-7.md");
    expect(text).toContain("report-3.md");
    expect(text).not.toContain("report-2.md");
    expect(text).toContain("overview.outputs.showMore");

    const more = container.querySelector<HTMLButtonElement>(
      'button[aria-label="overview.outputs.showMore"]',
    );
    expect(more).not.toBeNull();
    await act(async () => more?.click());

    expect(container.textContent).toContain("report-1.md");
  });

  it("opens an artifact through the shared hook", async () => {
    seedSteps([writeStep(1)]);

    await act(async () => {
      root.render(<OutputsSection />);
    });
    const row = container.querySelector<HTMLButtonElement>(
      'button[aria-label="report-1.md"]',
    );
    expect(row).not.toBeNull();
    await act(async () => row?.click());

    expect(openArtifact).toHaveBeenCalledWith(
      "/repo/out/report-1.md",
      "report-1.md",
    );
  });
});

describe("ChangesSection", () => {
  it("renders the compact additions and deletions", async () => {
    await act(async () => {
      root.render(
        <ChangesSection
          cwd="/repo"
          repo={repoResult({
            summary: {
              isRepo: true,
              branch: "main",
              additions: 73562,
              deletions: 7640,
              changedFiles: 12,
              untracked: 3,
            },
          })}
        />,
      );
    });

    const text = container.textContent ?? "";
    expect(text).toContain("+73.6k");
    expect(text).toContain("−7.6k");
    expect(text).toContain("overview.changes.untracked");
  });

  it("explains a non-repository instead of showing zeros", async () => {
    await act(async () => {
      root.render(
        <ChangesSection
          cwd="/plain"
          repo={repoResult({
            summary: {
              isRepo: false,
              branch: null,
              additions: 0,
              deletions: 0,
              changedFiles: 0,
              untracked: 0,
            },
          })}
        />,
      );
    });

    expect(container.textContent).toContain("overview.changes.notRepo");
    expect(container.textContent).not.toContain("+0");
  });
});
