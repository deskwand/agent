// @vitest-environment jsdom
//
// 默认环境是 node，这个文件要断言 localStorage 里的 lastSessionId。

import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../renderer/store";

describe("startNewSession", () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true);
    localStorage.clear();
  });

  it("clears the active session, the working dir and returns to chat", () => {
    useAppStore.setState({
      activeSessionId: "s1",
      workingDir: "/tmp/project",
      activeView: "settings",
    });

    useAppStore.getState().startNewSession();

    const state = useAppStore.getState();
    expect(state.activeSessionId).toBeNull();
    expect(state.workingDir).toBeNull();
    expect(state.activeView).toBe("chat");
  });

  it("drops the persisted last session id", () => {
    // 回归：不能图省事写成 set({ activeSessionId: null }) —— 只有 setActiveSession(null)
    // 会清 localStorage，否则重启后又会回到上一个会话
    localStorage.setItem("deskwand.lastSessionId", "s1");
    useAppStore.setState({ activeSessionId: "s1" });

    useAppStore.getState().startNewSession();

    expect(localStorage.getItem("deskwand.lastSessionId")).toBeNull();
  });

  it("leaves the session list alone", () => {
    useAppStore.setState({
      sessions: [
        {
          id: "s1",
          title: "keep me",
          status: "idle",
          mountedPaths: [],
          allowedTools: [],
          memoryEnabled: false,
          isProjectMode: false,
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      activeSessionId: "s1",
    });

    useAppStore.getState().startNewSession();

    expect(useAppStore.getState().sessions.map((s) => s.id)).toEqual(["s1"]);
  });
});
