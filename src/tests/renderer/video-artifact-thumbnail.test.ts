// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoArtifactThumbnail } from "../../renderer/components/message/VideoArtifactThumbnail";
import type { VideoReference } from "../../renderer/utils/video-reference";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const inlineReference: VideoReference = {
  path: "/repo/clip.mp4",
  name: "clip.mp4",
  playbackKind: "inline",
};
const getVideoSourceUrl = vi.fn(async () => "deskwand-media://local/signed");
const onOpen = vi.fn();

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.electronAPI = {
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

async function renderReference(reference: VideoReference): Promise<void> {
  await act(async () => {
    root.render(
      React.createElement(VideoArtifactThumbnail, { reference, onOpen }),
    );
  });
}

describe("VideoArtifactThumbnail", () => {
  it("requests a signed MP4 source without enabling playback controls", async () => {
    await renderReference(inlineReference);
    const video = container.querySelector("video");
    expect(getVideoSourceUrl).toHaveBeenCalledWith("/repo/clip.mp4");
    expect(video?.controls).toBe(false);
    expect(video?.autoplay).toBe(false);
    expect(video?.muted).toBe(true);
  });

  it("uses a generic cover without requesting a source for MOV", async () => {
    await renderReference({
      path: "/repo/clip.mov",
      name: "clip.mov",
      playbackKind: "external",
    });
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector(".lucide-video")).not.toBeNull();
    expect(getVideoSourceUrl).not.toHaveBeenCalled();
  });

  it("opens from the native thumbnail button", async () => {
    await renderReference(inlineReference);
    const button = container.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("videoPlayer.previewLabel");
    await act(async () => button?.click());
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("falls back to the generic cover after a media error", async () => {
    await renderReference(inlineReference);
    await act(async () => {
      container.querySelector("video")?.dispatchEvent(new Event("error"));
    });
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector(".lucide-video")).not.toBeNull();
  });
});

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
