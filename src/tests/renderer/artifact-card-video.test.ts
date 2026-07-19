// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import { ArtifactCard } from "../../renderer/components/message/ArtifactCard";
import { useAppStore } from "../../renderer/store";
import type { Session } from "../../renderer/types";
import type { ResultFileEntry } from "../../renderer/utils/tool-display-blocks";
import type { VideoReference } from "../../renderer/utils/video-reference";

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({ isElectron: true }),
}));
vi.mock("../../renderer/components/FilePreviewModal", () => ({
  FilePreviewModal: ({
    fileName,
    autoPlay,
  }: {
    fileName: string;
    autoPlay?: boolean;
  }) =>
    React.createElement(
      "div",
      { "data-testid": "preview-modal", "data-autoplay": String(autoPlay) },
      fileName,
    ),
}));

const videoReference: VideoReference = {
  path: "/repo/output/clip.mp4",
  name: "clip.mp4",
  playbackKind: "inline",
};
const getDiffFiles = vi.fn();
let container: HTMLDivElement;
let root: Root;

function makeSession(): Session {
  return {
    id: "session-1",
    title: "Video artifact test",
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

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  useAppStore.setState(useAppStore.getInitialState());
  useAppStore.setState({
    activeSessionId: "session-1",
    sessions: [makeSession()],
  });
  window.electronAPI = {
    git: {
      hasChanges: vi.fn(async () => ({ isRepo: true, changeCount: 1 })),
    },
    review: { getDiffFiles },
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

async function renderCard(
  files: ResultFileEntry[],
  videoReferences: VideoReference[],
): Promise<void> {
  await act(async () => {
    root.render(
      React.createElement(ArtifactCard, {
        files,
        videoReferences,
        isLatestRound: true,
      }),
    );
  });
}

function findVideoButton(rootElement: HTMLElement): HTMLButtonElement {
  const button = Array.from(rootElement.querySelectorAll("button")).find(
    (element) =>
      element.textContent?.includes("播放") ||
      element.textContent?.includes("Play"),
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("video button missing");
  }
  return button;
}

describe("ArtifactCard video references", () => {
  it("renders for a video-only result", async () => {
    await renderCard([], [videoReference]);
    expect(container.textContent).toContain("clip.mp4");
    const playBtn = findVideoButton(container);
    expect(playBtn).toBeDefined();
  });

  it("suppresses a duplicate regular row without changing the files input", async () => {
    const files = [
      {
        path: "output/clip.mp4",
        edits: 0,
        writes: 1,
        addedLines: 0,
        removedLines: 0,
      },
    ];
    await renderCard(files, [videoReference]);
    expect(container.textContent?.match(/clip\.mp4/g)).toHaveLength(1);
    expect(files).toEqual([
      {
        path: "output/clip.mp4",
        edits: 0,
        writes: 1,
        addedLines: 0,
        removedLines: 0,
      },
    ]);
  });

  it("opens FilePreviewModal directly from a video thumbnail", async () => {
    await renderCard([], [videoReference]);
    await act(async () => findVideoButton(container).click());
    const modal = document.body.querySelector('[data-testid="preview-modal"]');
    expect(modal).not.toBeNull();
    expect(modal?.getAttribute("data-autoplay")).toBe("true");
    expect(getDiffFiles).not.toHaveBeenCalled();
  });

  it("does not show mutation actions for a reference-only card", async () => {
    await renderCard([], [videoReference]);
    expect(container.textContent).not.toMatch(
      /Revert|撤销|Review Changes|审核变更/,
    );
  });

  it("keeps non-video edited and new rows beside videos", async () => {
    await renderCard(
      [
        {
          path: "src/example.ts",
          edits: 1,
          writes: 0,
          addedLines: 0,
          removedLines: 0,
        },
        {
          path: "docs/readme.md",
          edits: 0,
          writes: 1,
          addedLines: 0,
          removedLines: 0,
        },
      ],
      [videoReference],
    );
    expect(container.textContent).toContain("src/example.ts");
    expect(container.textContent).toContain("docs/readme.md");
    expect(container.textContent).toContain("clip.mp4");
  });
});

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
