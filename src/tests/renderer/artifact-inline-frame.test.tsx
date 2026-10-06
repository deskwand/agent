// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import i18n from "../../renderer/i18n/config";
import { ArtifactInlineFrame } from "../../renderer/components/message/ArtifactInlineFrame";

const getRenderUrl = vi.hoisted(() => vi.fn());
const openInBrowser = vi.hoisted(() => vi.fn());

vi.mock("../../renderer/utils/open-in-browser", () => ({
  openFilePathInBrowser: openInBrowser,
  openBrowserPanel: vi.fn(),
}));

const ARTIFACT = { path: "/w/report.html", name: "report.html" };

describe("ArtifactInlineFrame", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    getRenderUrl.mockReset();
    openInBrowser.mockReset();
    (globalThis as unknown as { window: Window }).window.electronAPI = {
      artifact: { getRenderUrl },
    } as unknown as typeof window.electronAPI;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders no iframe while folded", () => {
    act(() => {
      root.render(
        <ArtifactInlineFrame
          artifact={ARTIFACT}
          expanded={false}
          onToggle={() => {}}
        />,
      );
    });
    expect(container.querySelector("iframe")).toBeNull();
    expect(getRenderUrl).not.toHaveBeenCalled();
  });

  it("renders a sandboxed iframe when expanded", async () => {
    getRenderUrl.mockResolvedValue(
      "deskwand-artifact://local/root/sig/report.html",
    );
    await act(async () => {
      root.render(
        <ArtifactInlineFrame
          artifact={ARTIFACT}
          expanded={true}
          onToggle={() => {}}
        />,
      );
      await Promise.resolve();
    });
    const frame = container.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.getAttribute("src")).toContain("deskwand-artifact://");
  });

  it("shows the failure row when no url can be minted", async () => {
    getRenderUrl.mockResolvedValue(null);
    await act(async () => {
      root.render(
        <ArtifactInlineFrame
          artifact={ARTIFACT}
          expanded={true}
          onToggle={() => {}}
        />,
      );
      await Promise.resolve();
    });
    expect(container.querySelector("iframe")).toBeNull();
    expect(
      container.querySelector('[data-testid="artifact-inline-failed"]'),
    ).not.toBeNull();
  });

  it("re-mints the url when it is expanded after being folded", async () => {
    getRenderUrl.mockResolvedValue(
      "deskwand-artifact://local/root/sig/report.html",
    );
    act(() => {
      root.render(
        <ArtifactInlineFrame
          artifact={ARTIFACT}
          expanded={false}
          onToggle={() => {}}
        />,
      );
    });
    expect(getRenderUrl).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        <ArtifactInlineFrame
          artifact={ARTIFACT}
          expanded={true}
          onToggle={() => {}}
        />,
      );
      await Promise.resolve();
    });
    expect(getRenderUrl).toHaveBeenCalledTimes(1);
  });

  it("opens the file in the browser panel", async () => {
    getRenderUrl.mockResolvedValue(
      "deskwand-artifact://local/root/sig/report.html",
    );
    await act(async () => {
      root.render(
        <ArtifactInlineFrame
          artifact={ARTIFACT}
          expanded={true}
          onToggle={() => {}}
        />,
      );
      await Promise.resolve();
    });
    const button = container.querySelector(
      `button[aria-label="${i18n.t("artifact.inline.openInBrowser")}"]`,
    );
    act(() => (button as HTMLButtonElement).click());
    expect(openInBrowser).toHaveBeenCalledWith("/w/report.html");
  });

  it("asks the parent to toggle", () => {
    const onToggle = vi.fn();
    act(() => {
      root.render(
        <ArtifactInlineFrame
          artifact={ARTIFACT}
          expanded={false}
          onToggle={onToggle}
        />,
      );
    });
    act(() => {
      (container.querySelector("button") as HTMLButtonElement).click();
    });
    expect(onToggle).toHaveBeenCalledWith("/w/report.html");
  });
});
