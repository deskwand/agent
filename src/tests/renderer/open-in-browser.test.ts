// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openFilePathInBrowser } from "../../renderer/utils/open-in-browser";
import { useAppStore } from "../../renderer/store";

describe("openFilePathInBrowser", () => {
  const navigate = vi.fn();

  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { browser: { navigate } },
    });
  });

  it("switches the right panel to the browser and navigates to the file URL", () => {
    openFilePathInBrowser("/repo/index.html");

    expect(useAppStore.getState().rightPanelMode).toBe("browser");
    expect(navigate).toHaveBeenCalledWith("file:///repo/index.html");
  });

  it("keeps an already-open browser panel open", () => {
    useAppStore.setState({
      rightPanelMode: "browser",
      sidebarCollapsed: false,
    });

    openFilePathInBrowser("/repo/manual.pdf");

    expect(useAppStore.getState().rightPanelMode).toBe("browser");
    expect(navigate).toHaveBeenCalledWith("file:///repo/manual.pdf");
  });

  it("returns to the chat view first, otherwise a full-page view hides the panel", () => {
    useAppStore.setState({ activeView: "vault" });

    openFilePathInBrowser("/vault/report.pdf");

    expect(useAppStore.getState().activeView).toBe("chat");
    expect(useAppStore.getState().rightPanelMode).toBe("browser");
    expect(navigate).toHaveBeenCalledWith("file:///vault/report.pdf");
  });

  it("ignores a path that cannot become a local file URL", () => {
    openFilePathInBrowser("null/report.pdf");

    expect(navigate).not.toHaveBeenCalled();
    expect(useAppStore.getState().rightPanelMode).toBeNull();
    expect(useAppStore.getState().activeView).toBe("chat");
  });
});
