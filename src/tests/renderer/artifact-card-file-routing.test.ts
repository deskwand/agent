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
  addedLines: 5,
  removedLines: 2,
};

const editedHtmlFile = {
  path: "src/page.html",
  edits: 1,
  writes: 0,
  addedLines: 3,
  removedLines: 1,
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

function findEditedFileRow(
  container: HTMLElement,
  needle = "src/example.ts",
): HTMLElement {
  const row = Array.from(
    container.querySelectorAll<HTMLElement>('[role="button"]'),
  ).find((element) => element.textContent?.includes(needle));
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
  let navigate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
    useAppStore.setState({
      activeSessionId: "session-1",
      sessions: [makeSession("C:\\repo")],
      rightPanelMode: null,
      reviewTargetFile: null,
    });

    getDiffFiles = vi.fn();
    readFile = vi.fn(async () => ({
      type: "error" as const,
      message: "test preview",
    }));
    navigate = vi.fn();
    window.electronAPI = {
      git: {
        hasChanges: vi.fn(async () => ({ isRepo: true, changeCount: 1 })),
      },
      review: {
        getDiffFiles,
      },
      readFile,
      browser: { navigate },
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

  async function renderAndClick(
    files = [editedFile],
    needle = "src/example.ts",
  ): Promise<void> {
    await act(async () => {
      root.render(
        React.createElement(ArtifactCard, {
          files,
          videoReferences: [],
          isLatestRound: false,
        }),
      );
    });
    await flush();

    const row = findEditedFileRow(container, needle);
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
    expect(useAppStore.getState().rightPanelMode).toBe("review");
    expect(useAppStore.getState().previewTabs).toEqual([]);
  });

  it("previews the edited file when it no longer has a diff", async () => {
    useAppStore.setState({ sessions: [makeSession("/repo")] });
    getDiffFiles.mockResolvedValue([]);

    await renderAndClick();

    expect(useAppStore.getState().previewTabs).toEqual([
      { path: "/repo/src/example.ts", name: "example.ts" },
    ]);
    expect(useAppStore.getState().rightPanelMode).not.toBe("review");
    expect(navigate).not.toHaveBeenCalled();
    expect(useAppStore.getState().rightPanelMode).toBe("preview");
  });

  it("ignores a diff for a different file with the same basename", async () => {
    useAppStore.setState({ sessions: [makeSession("/repo")] });
    getDiffFiles.mockResolvedValue([
      { path: "example.ts", additions: 1, deletions: 0, status: "M" },
    ]);

    await renderAndClick();

    expect(useAppStore.getState().previewTabs).toEqual([
      { path: "/repo/src/example.ts", name: "example.ts" },
    ]);
    expect(useAppStore.getState().rightPanelMode).not.toBe("review");
  });

  it("previews the edited file when the diff query fails", async () => {
    useAppStore.setState({ sessions: [makeSession("/repo")] });
    getDiffFiles.mockRejectedValue(new Error("git unavailable"));

    await renderAndClick();

    expect(useAppStore.getState().previewTabs).toEqual([
      { path: "/repo/src/example.ts", name: "example.ts" },
    ]);
    expect(useAppStore.getState().rightPanelMode).not.toBe("review");
  });

  it("opens a browser-openable edited file in the internal browser", async () => {
    useAppStore.setState({ sessions: [makeSession("/repo")] });
    getDiffFiles.mockResolvedValue([]);

    await renderAndClick([editedHtmlFile], "src/page.html");

    expect(navigate).toHaveBeenCalledWith("file:///repo/src/page.html");
    expect(useAppStore.getState().rightPanelMode).toBe("browser");
    expect(useAppStore.getState().previewTabs).toEqual([]);
  });

  it("keeps the diff review for a browser-openable file that still has a diff", async () => {
    useAppStore.setState({ sessions: [makeSession("/repo")] });
    getDiffFiles.mockResolvedValue([
      { path: "src/page.html", additions: 3, deletions: 1, status: "M" },
    ]);

    await renderAndClick([editedHtmlFile], "src/page.html");

    expect(useAppStore.getState().rightPanelMode).toBe("review");
    expect(useAppStore.getState().reviewTargetFile).toBe("src/page.html");
    expect(navigate).not.toHaveBeenCalled();
  });
});
