// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import { ArtifactCard } from "../../renderer/components/message/ArtifactCard";
import { useAppStore } from "../../renderer/store";
import type { Session } from "../../renderer/types";

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({ isElectron: true }),
}));

const editedFile = {
  path: "src/example.ts",
  edits: 1,
  writes: 0,
};

function makeSession(cwd: string): Session {
  return {
    id: "session-1",
    title: "Artifact routing test",
    status: "idle",
    cwd,
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function findEditedFileRow(container: HTMLElement): HTMLElement {
  const row = Array.from(
    container.querySelectorAll<HTMLElement>('[role="button"]'),
  ).find((element) => element.textContent?.includes("src/example.ts"));
  if (!row) {
    throw new Error("Edited artifact row not found");
  }
  return row;
}

describe("ArtifactCard edited-file routing", () => {
  let container: HTMLDivElement;
  let root: Root;
  let getDiffFiles: ReturnType<typeof vi.fn>;
  let readFile: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
    useAppStore.setState({
      activeSessionId: "session-1",
      sessions: [makeSession("C:\\repo")],
      isReviewOpen: false,
      reviewTargetFile: null,
    });

    getDiffFiles = vi.fn();
    readFile = vi.fn(async () => ({
      type: "error" as const,
      message: "test preview",
    }));
    window.electronAPI = {
      git: {
        hasChanges: vi.fn(async () => ({ isRepo: true, changeCount: 1 })),
      },
      review: {
        getDiffFiles,
      },
      readFile,
    } as unknown as typeof window.electronAPI;

    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
  });

  async function renderAndClick(): Promise<void> {
    await act(async () => {
      root.render(
        React.createElement(ArtifactCard, {
          files: [editedFile],
          isLatestRound: false,
        }),
      );
    });
    await flush();

    const row = findEditedFileRow(container);
    await act(async () => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flush();
  }

  it("opens targeted review when the edited file still has a diff", async () => {
    getDiffFiles.mockResolvedValue([
      { path: "example.ts", additions: 1, deletions: 0, status: "M" },
      { path: "src/example.ts", additions: 2, deletions: 1, status: "M" },
    ]);

    await renderAndClick();

    expect(getDiffFiles).toHaveBeenCalledWith("C:\\repo");
    expect(useAppStore.getState().reviewTargetFile).toBe("src/example.ts");
    expect(useAppStore.getState().isReviewOpen).toBe(true);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("previews the edited file when it no longer has a diff", async () => {
    useAppStore.setState({ sessions: [makeSession("/repo")] });
    getDiffFiles.mockResolvedValue([]);

    await renderAndClick();

    expect(readFile).toHaveBeenCalledWith("/repo/src/example.ts");
    expect(useAppStore.getState().isReviewOpen).toBe(false);
  });

  it("ignores a diff for a different file with the same basename", async () => {
    useAppStore.setState({ sessions: [makeSession("/repo")] });
    getDiffFiles.mockResolvedValue([
      { path: "example.ts", additions: 1, deletions: 0, status: "M" },
    ]);

    await renderAndClick();

    expect(readFile).toHaveBeenCalledWith("/repo/src/example.ts");
    expect(useAppStore.getState().isReviewOpen).toBe(false);
  });

  it("previews the edited file when the diff query fails", async () => {
    useAppStore.setState({ sessions: [makeSession("/repo")] });
    getDiffFiles.mockRejectedValue(new Error("git unavailable"));

    await renderAndClick();

    expect(readFile).toHaveBeenCalledWith("/repo/src/example.ts");
    expect(useAppStore.getState().isReviewOpen).toBe(false);
  });
});
