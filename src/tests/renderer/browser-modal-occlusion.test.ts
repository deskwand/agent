import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../renderer/store";
import {
  shouldShowBrowserView,
  shouldSuppressVisibleBrowser,
} from "../../renderer/utils/browser-visibility";

function resetOcclusion(): void {
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
}

describe("browser modal occlusion registry", () => {
  beforeEach(resetOcclusion);
  afterEach(resetOcclusion);

  it("acquires identifiers idempotently", () => {
    const { acquireBrowserOcclusion } = useAppStore.getState();

    acquireBrowserOcclusion("preview");
    acquireBrowserOcclusion("preview");

    expect([...useAppStore.getState().browserOcclusionIds]).toEqual([
      "preview",
    ]);
  });

  it("keeps occlusion active until the final identifier is released", () => {
    const { acquireBrowserOcclusion, releaseBrowserOcclusion } =
      useAppStore.getState();

    acquireBrowserOcclusion("preview");
    acquireBrowserOcclusion("confirm");
    releaseBrowserOcclusion("preview");

    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);
    expect(useAppStore.getState().browserOcclusionIds.has("confirm")).toBe(
      true,
    );

    releaseBrowserOcclusion("confirm");
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("ignores release of an unknown identifier", () => {
    const { acquireBrowserOcclusion, releaseBrowserOcclusion } =
      useAppStore.getState();

    acquireBrowserOcclusion("preview");
    releaseBrowserOcclusion("unknown");

    expect([...useAppStore.getState().browserOcclusionIds]).toEqual([
      "preview",
    ]);
  });
});

describe("browser visibility decision", () => {
  it("suppresses externally shown browser content behind blocking UI", () => {
    expect(shouldSuppressVisibleBrowser(true, false)).toBe(true);
    expect(shouldSuppressVisibleBrowser(false, true)).toBe(true);
    expect(shouldSuppressVisibleBrowser(false, false)).toBe(false);
  });

  it("shows only the selected unobstructed browser panel", () => {
    expect(shouldShowBrowserView("browser", false, false)).toBe(true);
  });

  it.each([
    ["browser", true, false],
    ["browser", false, true],
    ["files", false, false],
    [null, false, false],
  ] as const)(
    "hides for mode=%s fullScreen=%s modal=%s",
    (rightPanelMode, isFullScreenView, hasBrowserOcclusion) => {
      expect(
        shouldShowBrowserView(
          rightPanelMode,
          isFullScreenView,
          hasBrowserOcclusion,
        ),
      ).toBe(false);
    },
  );
});
