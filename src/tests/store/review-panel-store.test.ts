// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../renderer/store";

const TAB_A = { path: "/repo/a.ts", name: "a.ts" };
const TAB_B = { path: "/repo/b.ts", name: "b.ts" };

const mode = () => useAppStore.getState().rightPanelMode;
const entryOrigin = () => useAppStore.getState().familyEntryOrigin;
const lastContext = () => useAppStore.getState().lastVisibleContext;

function resetStore(): void {
  useAppStore.setState(useAppStore.getInitialState());
  useAppStore.setState({ sidebarCollapsed: false, sidebarWidth: 280 });
}

describe("right panel family bookkeeping", () => {
  beforeEach(resetStore);

  it("records the family entry origin when the preview opens", () => {
    useAppStore.getState().toggleFileBrowser();
    useAppStore.getState().openPreview(TAB_A);

    expect(mode()).toBe("preview");
    expect(entryOrigin()).toBe("files");
    expect(lastContext()).toBeNull();
  });

  it("records the last context panel when switching inside the family", () => {
    useAppStore.getState().openPreview(TAB_A);
    useAppStore.getState().openReview();

    expect(mode()).toBe("review");
    expect(lastContext()).toBe("preview");
    expect(entryOrigin()).toBeNull();
  });

  it("returns to the previous context panel when review closes", () => {
    useAppStore.getState().openPreview(TAB_A);
    useAppStore.getState().openReview();
    useAppStore.getState().closeReview();

    const state = useAppStore.getState();
    expect(state.rightPanelMode).toBe("preview");
    expect(state.previewTabs).toEqual([TAB_A]);
    expect(state.lastVisibleContext).toBeNull();
  });

  it("falls back to the entry origin when the preview closes after that", () => {
    useAppStore.getState().toggleFileBrowser();
    useAppStore.getState().openPreview(TAB_A);
    useAppStore.getState().openReview();
    useAppStore.getState().closeReview();
    useAppStore.getState().closePreviewTab(TAB_A.path);

    expect(mode()).toBe("files");
    expect(useAppStore.getState().previewTabs).toEqual([]);
  });

  it("never leaves an empty preview panel visible (cycle regression)", () => {
    useAppStore.getState().toggleFileBrowser();
    useAppStore.getState().openPreview(TAB_A);
    useAppStore.getState().openReview();
    useAppStore.getState().openPreview(TAB_B);
    useAppStore.getState().closePreviewTab(TAB_B.path);

    // 预览还有标签时仍在预览
    expect(mode()).toBe("preview");

    // 关掉最后一个标签：回刚才那块上下文面板（review），而不是回一块空面板
    useAppStore.getState().closePreviewTab(TAB_A.path);
    expect(mode()).toBe("review");
    expect(useAppStore.getState().previewTabs).toEqual([]);

    // 再关 review：回 familyEntryOrigin（lastVisibleContext 已消费，不会弹回预览）
    useAppStore.getState().closeReview();
    expect(mode()).toBe("files");
  });

  it("clears the last context panel when a switch-type panel takes over", () => {
    useAppStore.getState().openPreview(TAB_A);
    useAppStore.getState().openReview();
    useAppStore.getState().toggleFileBrowser();

    expect(mode()).toBe("files");
    expect(lastContext()).toBeNull();
  });

  it("keeps preview tabs when switching inside the family", () => {
    useAppStore.getState().openPreview(TAB_A);
    useAppStore.getState().openPreview(TAB_B);

    useAppStore.getState().toggleBrowserPanel();
    expect(useAppStore.getState().previewTabs).toHaveLength(2);

    useAppStore.getState().toggleFileBrowser();
    expect(useAppStore.getState().previewTabs).toHaveLength(2);
  });

  it("toggles review through the titlebar button", () => {
    useAppStore.getState().toggleReviewPanel();
    expect(mode()).toBe("review");

    useAppStore.getState().toggleReviewPanel();
    expect(mode()).toBeNull();
  });

  it("clears preview state on a session change whatever panel is visible", () => {
    useAppStore.setState({ activeSessionId: "session-1" });
    useAppStore.getState().openPreview(TAB_A);
    useAppStore.getState().openReview();

    useAppStore.getState().setActiveSession("session-2");

    const state = useAppStore.getState();
    expect(state.previewTabs).toEqual([]);
    expect(state.rightPanelMode).toBeNull();
    expect(state.familyEntryOrigin).toBeNull();
    expect(state.lastVisibleContext).toBeNull();
  });

  it("keeps the browser panel visible across a session change", () => {
    useAppStore.setState({ activeSessionId: "session-1" });
    useAppStore.getState().toggleBrowserPanel();

    useAppStore.getState().setActiveSession("session-2");

    expect(mode()).toBe("browser");
  });

  it("does not clear the preview when browser fullscreen opens", () => {
    useAppStore.getState().openPreview(TAB_A);

    useAppStore.getState().enterBrowserFullscreen();

    expect(useAppStore.getState().previewTabs).toEqual([TAB_A]);
  });

  it("gives the review panel three quarters of the available width", () => {
    useAppStore.getState().openReview();

    // jsdom 窗口 1024，侧栏自动收起 → 0.75 × 1024 = 768
    expect(useAppStore.getState().reviewWidth).toBe(768);
  });

  it("keeps a dragged review width across openings", () => {
    useAppStore.getState().openReview();
    useAppStore.getState().setReviewWidth(900);
    useAppStore.getState().setReviewWidthManual(true);
    useAppStore.getState().closeReview();

    useAppStore.getState().openReview();

    expect(useAppStore.getState().reviewWidth).toBe(900);
  });
});
