// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const openFilePathInBrowser = vi.fn();
vi.mock("../../renderer/utils/open-in-browser", () => ({
  openFilePathInBrowser: (path: string) => openFilePathInBrowser(path),
}));

const openOfficePreview = vi.fn();
vi.mock("../../renderer/utils/office-preview-runner", () => ({
  openOfficePreview: (path: string, options: unknown) =>
    openOfficePreview(path, options),
}));

import { useOpenArtifact } from "../../renderer/hooks/use-open-artifact";
import { useAppStore } from "../../renderer/store";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  const { openArtifact } = useOpenArtifact();
  return (
    <button
      type="button"
      onClick={() => {
        void openArtifact("/repo/report.html", "report.html");
      }}
    >
      run
    </button>
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  window.electronAPI = {
    openPath: vi.fn(async () => ({ error: undefined })),
  } as unknown as typeof window.electronAPI;
  container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  openFilePathInBrowser.mockReset();
  openOfficePreview.mockReset();
});

describe("useOpenArtifact", () => {
  it("sends html files to the in-app browser", async () => {
    act(() => {
      root.render(<Probe />);
    });
    const button = container.querySelector("button");
    await act(async () => button?.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(openFilePathInBrowser).toHaveBeenCalledWith("/repo/report.html");
  });
});
