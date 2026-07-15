// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoPlayer } from "../../renderer/components/VideoPlayer";
import { buildLocalVideoUrl } from "../../shared/video-file";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("VideoPlayer", () => {
  let container: HTMLDivElement;
  let root: Root;
  const openPath = vi.fn(async () => ({ error: null }));
  const getVideoSourceUrl = vi.fn(async (filePath: string) =>
    buildLocalVideoUrl(filePath, "signed-value"),
  );

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    window.electronAPI = {
      openPath,
      getVideoSourceUrl,
    } as unknown as typeof window.electronAPI;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function render(fileName: string, autoPlay = false): Promise<void> {
    await act(async () => {
      root.render(
        React.createElement(VideoPlayer, {
          filePath: `/tmp/${fileName}`,
          fileName,
          autoPlay,
        }),
      );
    });
  }

  it("renders native controls for MP4", async () => {
    await render("clip.mp4");
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.controls).toBe(true);
    expect(video?.autoplay).toBe(false);
    expect(getVideoSourceUrl).toHaveBeenCalledWith("/tmp/clip.mp4");
    const url = new URL(video?.src ?? "");
    expect(url.searchParams.get("path")).toBe("/tmp/clip.mp4");
    expect(url.searchParams.get("signature")).toBe("signed-value");
  });

  it("uses unmuted native autoplay when requested", async () => {
    await render("clip.mp4", true);
    const video = container.querySelector("video");
    expect(video?.autoplay).toBe(true);
    expect(video?.muted).toBe(false);
  });

  it("uses system fallback for a recognized external-only container", async () => {
    await render("clip.mov");
    expect(container.querySelector("video")).toBeNull();
    expect(container.textContent).toContain("videoPlayer.externalOnly");
  });

  it("shows playback fallback after a native video error", async () => {
    await render("clip.mp4");
    await act(async () => {
      container.querySelector("video")?.dispatchEvent(new Event("error"));
    });
    expect(container.textContent).toContain("videoPlayer.playbackFailed");
  });

  it("opens the local path with the system player", async () => {
    await render("clip.mov");
    await act(async () => {
      (container.querySelector("button") as HTMLButtonElement).click();
    });
    expect(openPath).toHaveBeenCalledWith("/tmp/clip.mov");
  });
});

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
