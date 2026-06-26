import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "../../renderer/store";

function resetStore() {
  useAppStore.setState({
    isBrowserFullscreen: false,
    browserFullscreenSnapshot: null,
    rightPanelMode: null,
    contextPanelWidth: 340,
    sidebarCollapsed: false,
    sidebarWidth: 280,
  });
}

describe("Browser fullscreen store", () => {
  beforeEach(() => {
    resetStore();
  });

  it("isBrowserFullscreen defaults to false", () => {
    expect(useAppStore.getState().isBrowserFullscreen).toBe(false);
    expect(useAppStore.getState().browserFullscreenSnapshot).toBeNull();
  });

  it("enterBrowserFullscreen saves snapshot and sets flag", () => {
    // Set up some initial state
    useAppStore.setState({
      rightPanelMode: "browser",
      contextPanelWidth: 400,
    });

    useAppStore.getState().enterBrowserFullscreen();

    const state = useAppStore.getState();
    expect(state.isBrowserFullscreen).toBe(true);
    expect(state.browserFullscreenSnapshot).toEqual({
      rightPanelMode: "browser",
      contextPanelWidth: 400,
    });
  });

  it("enterBrowserFullscreen with right panel closed saves null mode", () => {
    useAppStore.getState().enterBrowserFullscreen();

    const state = useAppStore.getState();
    expect(state.isBrowserFullscreen).toBe(true);
    expect(state.browserFullscreenSnapshot).toEqual({
      rightPanelMode: null,
      contextPanelWidth: 340,
    });
  });

  it("enterBrowserFullscreen with file browser saves correct mode", () => {
    useAppStore.setState({
      rightPanelMode: "files",
      contextPanelWidth: 320,
    });

    useAppStore.getState().enterBrowserFullscreen();

    expect(useAppStore.getState().browserFullscreenSnapshot).toEqual({
      rightPanelMode: "files",
      contextPanelWidth: 320,
    });
  });

  it("exitBrowserFullscreen restores snapshot and clears flag", () => {
    // Simulate entering fullscreen with a snapshot
    useAppStore.setState({
      isBrowserFullscreen: true,
      browserFullscreenSnapshot: {
        rightPanelMode: "browser",
        contextPanelWidth: 420,
      },
      rightPanelMode: null, // layout was overridden
      contextPanelWidth: 800, // changed by fullscreen
    });

    useAppStore.getState().exitBrowserFullscreen();

    const state = useAppStore.getState();
    expect(state.isBrowserFullscreen).toBe(false);
    expect(state.browserFullscreenSnapshot).toBeNull();
    expect(state.rightPanelMode).toBe("browser");
    expect(state.contextPanelWidth).toBe(420);
  });

  it("exitBrowserFullscreen with null snapshot does not crash", () => {
    useAppStore.setState({
      isBrowserFullscreen: true,
      browserFullscreenSnapshot: null,
      rightPanelMode: "browser",
      contextPanelWidth: 400,
    });

    expect(() => useAppStore.getState().exitBrowserFullscreen()).not.toThrow();

    const state = useAppStore.getState();
    expect(state.isBrowserFullscreen).toBe(false);
    expect(state.browserFullscreenSnapshot).toBeNull();
    // rightPanelMode and contextPanelWidth are NOT restored when snapshot is null
    expect(state.rightPanelMode).toBe("browser");
    expect(state.contextPanelWidth).toBe(400);
  });

  it("snapshot fields are independent of other UI state", () => {
    useAppStore.setState({
      rightPanelMode: "browser",
      contextPanelWidth: 500,
      sidebarCollapsed: true,
      sidebarWidth: 200,
    });

    useAppStore.getState().enterBrowserFullscreen();

    const state = useAppStore.getState();
    expect(state.browserFullscreenSnapshot?.rightPanelMode).toBe("browser");
    expect(state.browserFullscreenSnapshot?.contextPanelWidth).toBe(500);
    // sidebar state is NOT in snapshot (not needed for restore)
    expect(state.sidebarCollapsed).toBe(true);
    expect(state.sidebarWidth).toBe(200);
  });
});
