import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../src/renderer/store";

describe("top-level navigation", () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true);
  });

  it("keeps top-level views mutually exclusive", () => {
    const store = useAppStore.getState();

    store.setActiveView("apps");
    expect(useAppStore.getState().activeView).toBe("apps");

    store.setActiveView("vault");
    expect(useAppStore.getState().activeView).toBe("vault");

    store.setActiveView("settings");
    expect(useAppStore.getState().activeView).toBe("settings");

    store.setActiveView("chat");
    expect(useAppStore.getState().activeView).toBe("chat");
  });

  it("keeps the active session when switching to a peer view", () => {
    // 回归：导航从侧栏搬到图标栏后，切视图不能顺手清空 activeSessionId，
    // 否则从 Vault / 应用 / 设置返回聊天会落到 WelcomeView。
    for (const view of [
      "apps",
      "automation",
      "vault",
      "settings",
      "usage",
    ] as const) {
      useAppStore.setState({
        activeSessionId: "s1",
        activeView: "chat",
      });

      useAppStore.getState().setActiveView(view);

      expect(useAppStore.getState().activeView, view).toBe(view);
      expect(useAppStore.getState().activeSessionId, view).toBe("s1");
    }
  });

  it("preserves the sidebar collapsed flag across view switches", () => {
    // 设计决策 7：切视图不碰 sidebarCollapsed，返回聊天自然恢复原状——
    // 这条不变量没有代码可读（靠「不写」成立），所以用行为钉住。
    useAppStore.setState({
      activeSessionId: "s1",
      activeView: "chat",
      sidebarCollapsed: true,
    });

    useAppStore.getState().setActiveView("settings");
    expect(useAppStore.getState().sidebarCollapsed).toBe(true);

    useAppStore.getState().setActiveView("chat");
    expect(useAppStore.getState().sidebarCollapsed).toBe(true);
  });
});
