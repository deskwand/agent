// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import { ArtifactCard } from "../../renderer/components/message/ArtifactCard";
import { useAppStore } from "../../renderer/store";
import type { Session } from "../../renderer/types";
import type { ResultFileEntry } from "../../renderer/utils/tool-display-blocks";

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({ isElectron: true }),
}));

const editedFile: ResultFileEntry = {
  path: "src/example.ts",
  edits: 1,
  writes: 0,
  addedLines: 5,
  removedLines: 2,
};

const newFile: ResultFileEntry = {
  path: "src/new-file.ts",
  edits: 0,
  writes: 1,
  addedLines: 10,
  removedLines: 0,
};

const imageFile: ResultFileEntry = {
  path: "assets/preview.png",
  edits: 0,
  writes: 1,
  addedLines: 0,
  removedLines: 0,
};

function makeSession(): Session {
  return {
    id: "session-1",
    title: "Artifact visual test",
    status: "idle",
    cwd: "/repo",
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    isProjectMode: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function findFileCards(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll('[role="button"]'),
  ) as HTMLElement[];
}

describe("ArtifactCard visual hierarchy", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
    useAppStore.setState({
      activeSessionId: "session-1",
      sessions: [makeSession()],
    });
    window.electronAPI = {
      git: {
        hasChanges: vi.fn(async () => ({ isRepo: true, changeCount: 3 })),
      },
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

  async function render(files: ResultFileEntry[]): Promise<void> {
    await act(async () => {
      root.render(
        React.createElement(ArtifactCard, {
          files,
          videoReferences: [],
          isLatestRound: true,
        }),
      );
      await Promise.resolve();
    });
  }

  it("renders each file as a separate card", async () => {
    await render([editedFile, newFile, imageFile]);

    const cards = findFileCards(container);
    expect(cards).toHaveLength(3);
    expect(cards[0].textContent).toContain("src/example.ts");
    expect(cards[1].textContent).toContain("src/new-file.ts");
    expect(cards[2].textContent).toContain("assets/preview.png");
  });

  it("renders cards with rounded-xl border style", async () => {
    await render([editedFile]);

    const cards = findFileCards(container);
    expect(cards).toHaveLength(1);
    const cardEl = cards[0].closest(".rounded-xl");
    expect(cardEl).not.toBeNull();
    expect(cardEl?.classList.contains("border-border-subtle")).toBe(true);
  });

  it("shows file extension badges instead of paperclip/file icons", async () => {
    await render([editedFile, imageFile]);

    // No more Paperclip icon (used for old title)
    expect(container.querySelector(".lucide-paperclip")).toBeNull();
    // No more generic File icon
    expect(container.querySelector(".lucide-file")).toBeNull();
    // Has file extension text labels
    expect(container.textContent).toContain("TS");
    expect(container.textContent).toContain("PNG");
  });

  it("shows revert button always visible for latest round", async () => {
    await render([editedFile]);

    const revertBtn = Array.from(container.querySelectorAll("button")).find(
      (el) => {
        const text = el.textContent || "";
        return text.includes("撤销") || text === "Revert";
      },
    );
    expect(revertBtn).toBeDefined();
    // Should be visible, not opacity-0
    expect(revertBtn?.classList.contains("opacity-0")).toBe(false);
  });

  it("shows edit status and change count", async () => {
    await render([editedFile]);

    expect(container.textContent).toMatch(/编辑|Edited/);
    expect(container.textContent).toContain("+5");
  });

  it("shows new status and change count for new files", async () => {
    await render([newFile]);

    expect(container.textContent).toMatch(/新建|New/);
    expect(container.textContent).toContain("+10");
    expect(container.textContent).toContain("-0");
  });

  it("renders in a flex column layout", async () => {
    await render([editedFile, newFile]);

    // The wrapper should be a flex column for card stacking
    const wrapper = container.firstElementChild;
    expect(wrapper?.classList.contains("flex-col")).toBe(true);
  });

  it("does not show group labels or round title", async () => {
    await render([editedFile, newFile]);

    expect(container.textContent).not.toMatch(/本轮产物|Round Artifacts/);
    expect(container.textContent).not.toMatch(/编辑的文件|Edited Files/);
    expect(container.textContent).not.toMatch(/新建的文件|New Files/);
    expect(container.textContent).not.toMatch(/Videos|视频/);
  });

  it("does not show round revert button at bottom", async () => {
    await render([editedFile]);

    const buttons = Array.from(container.querySelectorAll("button"));
    const roundRevert = buttons.find(
      (el) =>
        el.textContent?.includes("撤销本轮") ||
        el.textContent?.includes("Revert Round"),
    );
    expect(roundRevert).toBeUndefined();
  });
});
