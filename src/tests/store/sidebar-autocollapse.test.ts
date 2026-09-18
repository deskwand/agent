// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../renderer/store";

const TAB_A = { path: "/repo/a.ts", name: "a.ts" };
const TAB_B = { path: "/repo/b.ts", name: "b.ts" };

const sidebar = () => useAppStore.getState().sidebarCollapsed;
const snapshot = () => useAppStore.getState().sidebarCollapsedBeforePanels;

function resetStore(): void {
  useAppStore.setState(useAppStore.getInitialState());
  useAppStore.setState({ sidebarCollapsed: false, sidebarWidth: 280 });
}

describe("sidebar auto collapse", () => {
  beforeEach(resetStore);

  it("collapses the sidebar when the preview opens", () => {
    useAppStore.getState().openPreview(TAB_A);

    expect(sidebar()).toBe(true);
    expect(snapshot()).toBe(false);
  });

  it("restores the sidebar when the last tab closes", () => {
    useAppStore.getState().openPreview(TAB_A);
    useAppStore.getState().closePreviewTab(TAB_A.path);

    expect(sidebar()).toBe(false);
    expect(snapshot()).toBeNull();
  });

  it("keeps the sidebar collapsed when it was already collapsed", () => {
    useAppStore.setState({ sidebarCollapsed: true });
    useAppStore.getState().openPreview(TAB_A);
    useAppStore.getState().closePreviewTab(TAB_A.path);

    expect(sidebar()).toBe(true);
    expect(snapshot()).toBeNull();
  });

  it("respects a manual toggle inside the panel family", () => {
    useAppStore.getState().openPreview(TAB_A);
    useAppStore.getState().toggleSidebar();

    expect(sidebar()).toBe(false);
    expect(snapshot()).toBeNull();

    useAppStore.getState().openPreview(TAB_B);
    expect(sidebar()).toBe(false);

    useAppStore.getState().closePreviewTab(TAB_B.path);
    useAppStore.getState().closePreviewTab(TAB_A.path);
    expect(sidebar()).toBe(false);
  });

  it("records a fresh snapshot after leaving and re-entering the family", () => {
    useAppStore.getState().openPreview(TAB_A);
    useAppStore.getState().closePreviewTab(TAB_A.path);

    useAppStore.getState().toggleSidebar();
    useAppStore.getState().openPreview(TAB_B);

    expect(snapshot()).toBe(true);

    useAppStore.getState().closePreviewTab(TAB_B.path);
    expect(sidebar()).toBe(true);
  });

  it("leaves the sidebar alone when switching between the two panels", () => {
    useAppStore.getState().toggleBrowserPanel();
    expect(sidebar()).toBe(true);
    expect(snapshot()).toBe(false);

    useAppStore.getState().openPreview(TAB_A);
    expect(sidebar()).toBe(true);
    expect(snapshot()).toBe(false);

    // 注意：模式是 preview 时 toggleBrowserPanel 是「打开浏览器」而不是关闭，
    // 所以这里要点两次才能真的退出面板家族。
    useAppStore.getState().toggleBrowserPanel();
    expect(sidebar()).toBe(true);
    expect(snapshot()).toBe(false);

    useAppStore.getState().toggleBrowserPanel();
    expect(useAppStore.getState().rightPanelMode).toBeNull();
    expect(sidebar()).toBe(false);
    expect(snapshot()).toBeNull();
  });

  it("keeps a manual expand when switching panels after it", () => {
    useAppStore.getState().openPreview(TAB_A);
    useAppStore.getState().toggleSidebar();

    useAppStore.getState().toggleBrowserPanel();

    expect(useAppStore.getState().rightPanelMode).toBe("browser");
    expect(sidebar()).toBe(false);
    expect(snapshot()).toBeNull();
  });

  it("restores the sidebar when the browser panel closes", () => {
    useAppStore.getState().toggleBrowserPanel();
    useAppStore.getState().toggleBrowserPanel();

    expect(sidebar()).toBe(false);
    expect(snapshot()).toBeNull();
  });

  it("restores the sidebar when the preview is replaced by the file panel", () => {
    useAppStore.getState().openPreview(TAB_A);
    useAppStore.getState().toggleFileBrowser();

    expect(useAppStore.getState().rightPanelMode).toBe("files");
    expect(sidebar()).toBe(false);
    expect(snapshot()).toBeNull();
  });

  it("does not touch the sidebar for the file panel alone", () => {
    useAppStore.getState().toggleFileBrowser();

    expect(sidebar()).toBe(false);
    expect(snapshot()).toBeNull();
  });

  it("restores the sidebar when the session changes during a preview", () => {
    useAppStore.setState({ activeSessionId: "session-1" });
    useAppStore.getState().openPreview(TAB_A);

    useAppStore.getState().setActiveSession("session-2");

    expect(sidebar()).toBe(false);
    expect(snapshot()).toBeNull();
  });

  it("keeps the sidebar collapsed while a family panel is still visible after fullscreen", () => {
    useAppStore.getState().openPreview(TAB_A);
    useAppStore.getState().enterBrowserFullscreen();

    useAppStore.getState().exitBrowserFullscreen();

    // 快照现在存当时的可见模式（不再把 preview 归一化成 null），
    // 退出后仍在面板家族里，所以侧栏保持收起
    expect(useAppStore.getState().rightPanelMode).toBe("preview");
    expect(sidebar()).toBe(true);

    // 真正离开家族（关掉预览）时才还原
    useAppStore.getState().closePreviewTab(TAB_A.path);
    expect(sidebar()).toBe(false);
    expect(snapshot()).toBeNull();
  });

  it("restores the sidebar when the file panel replaces the preview", () => {
    useAppStore.getState().openPreview(TAB_A);
    useAppStore.getState().toggleFileBrowser();

    expect(sidebar()).toBe(false);
    expect(snapshot()).toBeNull();
  });
});
