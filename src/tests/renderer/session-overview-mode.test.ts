// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../renderer/store";

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
});

describe("overview 右栏模式", () => {
  it("toggles the panel without touching the session sidebar", () => {
    const before = useAppStore.getState().sidebarCollapsed;

    useAppStore.getState().toggleOverview();
    expect(useAppStore.getState().rightPanelMode).toBe("overview");
    expect(useAppStore.getState().sidebarCollapsed).toBe(before);

    useAppStore.getState().toggleOverview();
    expect(useAppStore.getState().rightPanelMode).toBeNull();
  });

  it("returns to the overview after closing a review opened from it", () => {
    useAppStore.getState().toggleOverview();
    useAppStore.getState().openReview();
    expect(useAppStore.getState().rightPanelMode).toBe("review");

    useAppStore.getState().closeReview();
    expect(useAppStore.getState().rightPanelMode).toBe("overview");
  });

  it("restores the sidebar snapshot when leaving a review for the overview", () => {
    expect(useAppStore.getState().sidebarCollapsed).toBe(false);

    useAppStore.getState().toggleOverview();
    useAppStore.getState().openReview();
    // 进入 review 是面板家族，自动收起并记快照
    expect(useAppStore.getState().sidebarCollapsed).toBe(true);
    expect(useAppStore.getState().sidebarCollapsedBeforePanels).toBe(false);

    useAppStore.getState().toggleOverview();
    expect(useAppStore.getState().rightPanelMode).toBe("overview");
    expect(useAppStore.getState().sidebarCollapsed).toBe(false);
    expect(useAppStore.getState().sidebarCollapsedBeforePanels).toBeNull();
  });

  it("keeps the sidebar collapsed state when switching to the file browser", () => {
    useAppStore.getState().toggleOverview();
    const collapsed = useAppStore.getState().sidebarCollapsed;

    useAppStore.getState().toggleFileBrowser();
    expect(useAppStore.getState().rightPanelMode).toBe("files");
    expect(useAppStore.getState().sidebarCollapsed).toBe(collapsed);
  });
});

describe("pendingFocusToolCallId", () => {
  it("stores the request and clears it after consumption", () => {
    useAppStore.getState().requestFocusToolCall("call-1");
    expect(useAppStore.getState().pendingFocusToolCallId).toBe("call-1");

    useAppStore.getState().clearPendingFocusToolCall();
    expect(useAppStore.getState().pendingFocusToolCallId).toBeNull();
  });
});
