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
};

const newFile: ResultFileEntry = {
  path: "src/new-file.ts",
  edits: 0,
  writes: 1,
};

const imageFile: ResultFileEntry = {
  path: "assets/preview.png",
  edits: 0,
  writes: 1,
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

function artifactRoot(container: HTMLElement): HTMLElement {
  const element = container.firstElementChild;
  if (!(element instanceof HTMLElement)) {
    throw new Error("Artifact card root not found");
  }
  return element;
}

function findRoundRevertButton(container: HTMLElement): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (element) =>
      element.textContent?.includes("撤销本轮变更") ||
      element.textContent?.includes("Revert Round Changes"),
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("Round revert button not found");
  }
  return button;
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

  it.each([
    ["one", [editedFile]],
    ["two", [editedFile, newFile]],
  ])(
    "renders %s effective files as an inline section",
    async (_label, files) => {
      await render(files);

      const card = artifactRoot(container);
      expect(card.classList.contains("border-t")).toBe(true);
      expect(card.classList.contains("rounded-xl")).toBe(false);
      expect(card.classList.contains("shadow-soft")).toBe(false);
    },
  );

  it("renders three effective files in a weak container", async () => {
    await render([editedFile, newFile, imageFile]);

    const card = artifactRoot(container);
    expect(card.classList.contains("rounded-xl")).toBe(true);
    expect(card.classList.contains("border-border-subtle")).toBe(true);
    expect(card.classList.contains("bg-surface/40")).toBe(false);
    expect(card.classList.contains("bg-surface")).toBe(false);
    expect(card.classList.contains("shadow-soft")).toBe(false);
  });

  it("uses neutral paperclip and file icons", async () => {
    await render([editedFile, imageFile]);

    expect(container.textContent).not.toContain("✨");
    expect(container.querySelector(".lucide-paperclip")).not.toBeNull();
    expect(container.querySelectorAll(".lucide-file")).toHaveLength(2);
    expect(container.querySelector(".lucide-file-code")).toBeNull();
    expect(container.querySelector(".lucide-image")).toBeNull();
    expect(container.querySelector("svg.text-sky-400")).toBeNull();
    expect(container.querySelector("svg.text-accent")).toBeNull();
  });

  it("uses neutral row colors for new files", async () => {
    await render([newFile]);

    const row = Array.from(
      container.querySelectorAll<HTMLElement>('[role="button"]'),
    ).find((element) => element.textContent?.includes("src/new-file.ts"));
    expect(row).toBeDefined();
    expect(row?.classList.contains("text-text-secondary")).toBe(true);
    expect(row?.classList.contains("text-success")).toBe(false);
    expect(row?.classList.contains("hover:bg-surface-hover")).toBe(true);
    expect(row?.classList.contains("hover:bg-success/10")).toBe(false);
    expect(row?.classList.contains("active:bg-success/15")).toBe(false);
  });

  it("keeps round revert neutral until hover", async () => {
    await render([editedFile]);

    const button = findRoundRevertButton(container);
    expect(button.classList.contains("text-text-muted")).toBe(true);
    expect(button.classList.contains("text-error")).toBe(false);
    expect(button.classList.contains("hover:text-error")).toBe(true);
  });

  it("does not render dark backgrounds on file groups", async () => {
    await render([editedFile, newFile]);

    expect(container.querySelector(".bg-surface-muted")).toBeNull();
    expect(container.querySelector(".bg-success\\/5")).toBeNull();
  });
});
