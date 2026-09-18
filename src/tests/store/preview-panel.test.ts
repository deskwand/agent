// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../renderer/store";

const TAB_A = { path: "/repo/a.ts", name: "a.ts" };
const TAB_B = { path: "/repo/b.ts", name: "b.ts" };
const TAB_C = { path: "/repo/c.ts", name: "c.ts" };

function resetStore(): void {
  useAppStore.setState(useAppStore.getInitialState());
  // jsdom 的 window.innerWidth 是 1024 → 预览打开时侧栏自动收起 → 默认预览宽 512
  useAppStore.setState({ sidebarCollapsed: false, sidebarWidth: 280 });
}

describe("preview panel store", () => {
  beforeEach(resetStore);

  it("appends a tab, activates it and enters preview mode", () => {
    useAppStore.getState().openPreview(TAB_A);

    const state = useAppStore.getState();
    expect(state.rightPanelMode).toBe("preview");
    expect(state.previewTabs).toEqual([TAB_A]);
    expect(state.activePreviewTab).toBe(TAB_A.path);
  });

  it("records the family entry origin only when entering preview from outside the family", () => {
    useAppStore.getState().toggleFileBrowser();
    useAppStore.getState().openPreview(TAB_A);
    expect(useAppStore.getState().familyEntryOrigin).toBe("files");

    useAppStore.getState().openPreview(TAB_B);
    expect(useAppStore.getState().familyEntryOrigin).toBe("files");
  });

  it("focuses an already open file instead of adding a second tab", () => {
    useAppStore.getState().openPreview(TAB_A);
    useAppStore.getState().openPreview(TAB_B);
    useAppStore.getState().openPreview(TAB_A);

    const state = useAppStore.getState();
    expect(state.previewTabs.map((tab) => tab.path)).toEqual([
      TAB_A.path,
      TAB_B.path,
    ]);
    expect(state.activePreviewTab).toBe(TAB_A.path);
  });

  it("does not rewrite the label of an open tab", () => {
    useAppStore.getState().openPreview({ path: TAB_A.path, name: "shortcut" });
    useAppStore.getState().openPreview(TAB_A);

    expect(useAppStore.getState().previewTabs[0].name).toBe("shortcut");
  });

  it("keeps autoplay requested for a tab that is already open", () => {
    useAppStore.getState().openPreview({ path: TAB_A.path, name: "a.ts" });
    useAppStore
      .getState()
      .openPreview({ path: TAB_A.path, name: "a.ts", autoPlay: true });

    expect(useAppStore.getState().previewTabs).toEqual([
      { path: TAB_A.path, name: "a.ts", autoPlay: true },
    ]);
  });

  it("activates the right neighbour when the active tab closes", () => {
    useAppStore.getState().openPreview(TAB_A);
    useAppStore.getState().openPreview(TAB_B);
    useAppStore.getState().openPreview(TAB_C);

    useAppStore.getState().closePreviewTab(TAB_B.path);

    const state = useAppStore.getState();
    expect(state.previewTabs.map((tab) => tab.path)).toEqual([
      TAB_A.path,
      TAB_C.path,
    ]);
    expect(state.activePreviewTab).toBe(TAB_C.path);
  });

  it("activates the left neighbour when there is no right neighbour", () => {
    useAppStore.getState().openPreview(TAB_A);
    useAppStore.getState().openPreview(TAB_B);
    useAppStore.getState().openPreview(TAB_C);

    useAppStore.getState().closePreviewTab(TAB_C.path);

    expect(useAppStore.getState().activePreviewTab).toBe(TAB_B.path);
  });

  it("keeps the active tab when a background tab closes", () => {
    useAppStore.getState().openPreview(TAB_A);
    useAppStore.getState().openPreview(TAB_B);

    useAppStore.getState().closePreviewTab(TAB_A.path);

    const state = useAppStore.getState();
    expect(state.previewTabs).toEqual([TAB_B]);
    expect(state.activePreviewTab).toBe(TAB_B.path);
  });

  it("returns to the previous panel when the last tab closes", () => {
    useAppStore.getState().toggleFileBrowser();
    useAppStore.getState().openPreview(TAB_A);
    useAppStore.getState().closePreviewTab(TAB_A.path);

    const state = useAppStore.getState();
    expect(state.rightPanelMode).toBe("files");
    expect(state.previewTabs).toEqual([]);
    expect(state.activePreviewTab).toBeNull();
    expect(state.lastVisibleContext).toBeNull();
  });

  it("closes the panel through closePreviewPanel", () => {
    useAppStore.getState().openPreview(TAB_A);
    useAppStore.getState().openPreview(TAB_B);
    useAppStore.getState().closePreviewPanel();

    const state = useAppStore.getState();
    expect(state.rightPanelMode).toBeNull();
    expect(state.previewTabs).toEqual([]);
    expect(state.activePreviewTab).toBeNull();
  });

  // C 语义：家族内/家族间切换都保留标签，只有关掉预览本身与切换会话才清
  it.each([
    ["toggleFileBrowser", () => useAppStore.getState().toggleFileBrowser()],
    ["toggleBrowserPanel", () => useAppStore.getState().toggleBrowserPanel()],
    [
      "enterBrowserFullscreen",
      () => useAppStore.getState().enterBrowserFullscreen(),
    ],
  ] as const)("keeps the preview tabs via %s", (_name, switchPanel) => {
    useAppStore.getState().openPreview(TAB_A);

    switchPanel();

    const state = useAppStore.getState();
    expect(state.previewTabs).toEqual([TAB_A]);
  });

  it("clears the preview state when the session changes", () => {
    useAppStore.setState({ activeSessionId: "session-1" });
    useAppStore.getState().openPreview(TAB_A);

    useAppStore.getState().setActiveSession("other-session");

    const state = useAppStore.getState();
    expect(state.previewTabs).toEqual([]);
    expect(state.activePreviewTab).toBeNull();
    expect(state.lastVisibleContext).toBeNull();
  });

  it("keeps preview tabs when the active session does not change", () => {
    useAppStore.setState({ activeSessionId: "session-1" });
    useAppStore.getState().openPreview(TAB_A);

    useAppStore.getState().setActiveSession("session-1");

    expect(useAppStore.getState().previewTabs).toEqual([TAB_A]);
  });

  it("does not touch the file panel when switching sessions off preview", () => {
    useAppStore.getState().toggleFileBrowser();
    useAppStore.setState({ activeSessionId: "session-1" });

    useAppStore.getState().setActiveSession("session-2");

    expect(useAppStore.getState().rightPanelMode).toBe("files");
  });

  it("keeps the preview mode in the browser fullscreen snapshot", () => {
    useAppStore.getState().openPreview(TAB_A);

    useAppStore.getState().enterBrowserFullscreen();

    // 不再把 preview 归一化成 null：快照就是当时的可见模式
    expect(useAppStore.getState().browserFullscreenSnapshot).toEqual({
      rightPanelMode: "preview",
      contextPanelWidth: 288,
    });
  });

  it("does not borrow the context panel width", () => {
    useAppStore.setState({ contextPanelWidth: 288 });

    useAppStore.getState().openPreview(TAB_A);
    expect(useAppStore.getState().previewWidth).toBe(512);
    expect(useAppStore.getState().contextPanelWidth).toBe(288);

    useAppStore.getState().closePreviewTab(TAB_A.path);
    expect(useAppStore.getState().contextPanelWidth).toBe(288);
  });

  it("keeps the width the user dragged across previews", () => {
    useAppStore.getState().openPreview(TAB_A);
    useAppStore.getState().setPreviewWidth(720);
    useAppStore.getState().setPreviewWidthManual(true);
    useAppStore.getState().closePreviewTab(TAB_A.path);

    useAppStore.getState().openPreview(TAB_B);

    expect(useAppStore.getState().previewWidth).toBe(720);
  });

  it("recomputes the preview width for a fresh preview", () => {
    useAppStore.getState().openPreview(TAB_A);
    expect(useAppStore.getState().previewWidth).toBe(512);

    useAppStore.getState().setPreviewWidth(400);
    useAppStore.getState().openPreview(TAB_B);

    // 没手动拖过（previewWidthManual 仍为 false）→ 跟随布局重算
    expect(useAppStore.getState().previewWidth).toBe(512);
  });

  it("returns to the layout width after the handle is double clicked", () => {
    useAppStore.getState().openPreview(TAB_A);
    useAppStore.getState().setPreviewWidth(900);
    useAppStore.getState().setPreviewWidthManual(true);

    useAppStore.getState().setPreviewWidthManual(false);
    useAppStore.getState().closePreviewTab(TAB_A.path);
    useAppStore.getState().openPreview(TAB_B);

    expect(useAppStore.getState().previewWidth).toBe(512);
  });
});
