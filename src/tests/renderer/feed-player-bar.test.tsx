// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

import { FeedPlayerBar } from "../../renderer/components/FeedPlayerBar";
import { setFeedListenControllerForTests } from "../../renderer/hooks/useFeedListen";
import { useAppStore } from "../../renderer/store";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function sessionWith(index: number, skipped = 0) {
  return {
    session: {
      items: [
        {
          id: "a",
          title: "标题 A",
          sourceHost: "a.com",
          imageUrl: null,
          script: "一。",
        },
        {
          id: "b",
          title: "标题 B",
          sourceHost: "b.com",
          imageUrl: null,
          script: "二。",
        },
      ],
      index,
    },
    status: "playing" as const,
    progress: { current: 0, total: 2 },
    skipped,
  };
}

function el(testid: string): HTMLElement {
  return container.querySelector(`[data-testid="${testid}"]`) as HTMLElement;
}

beforeEach(() => {
  window.localStorage.setItem("i18nextLng", "en");
  useAppStore.setState(useAppStore.getInitialState(), true);
  setFeedListenControllerForTests(null);
  container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  // 不卸载的话，上一个用例挂上的 `useFeedListenInterrupts` 订阅还会活着，
  // 后一个用例的 setState 会把它一并唤醒。
  await act(async () => root.unmount());
  container.remove();
});

function render() {
  act(() => root.render(<FeedPlayerBar />));
}

describe("FeedPlayerBar", () => {
  it("没有会话时不渲染任何东西", () => {
    render();
    expect(
      container.querySelector('[data-testid="feed-player-bar"]'),
    ).toBeNull();
  });

  it("是右下角挂件、不占布局（照语音小球），胶囊只留四个元素", () => {
    useAppStore.setState({ feedListen: sessionWith(0) });
    render();
    // 悬浮在右下角：不占布局、不缩短内容区（底部通栏那版已被否决）
    expect(el("feed-player-bar").className).toContain("fixed");
    expect(el("feed-player-bar").className).toContain("right-4");
    expect(el("feed-player-bar").className).toContain("bottom-4");
    // 胶囊尺寸语言与 VoiceMiniBar 一致
    const capsule = el("feed-player-title").parentElement as HTMLElement;
    expect(capsule.className).toContain("max-w-[22rem]");
    expect(capsule.className).toContain("rounded-full");
    expect(el("feed-player-title").textContent).toBe("标题 A");
    expect(el("feed-player-toggle-capsule")).not.toBeNull();
    expect(el("feed-player-close-capsule")).not.toBeNull();
  });

  it("沙箱 Toast 在场时抬到 bottom-20（照 VoiceMiniBar 的让位）", () => {
    useAppStore.setState({
      feedListen: sessionWith(0),
      sandboxSyncStatus: {
        sessionId: "s1",
        phase: "error",
        message: "同步失败",
      },
    });
    render();
    expect(el("feed-player-bar").className).toContain("bottom-20");
    expect(el("feed-player-bar").className).not.toContain("bottom-4");
  });

  it("展开卡片默认不可见（hover / focus 才现）", () => {
    useAppStore.setState({ feedListen: sessionWith(0) });
    render();
    const card = el("feed-player-card");
    expect(card.className).toContain("invisible");
    expect(card.className).toContain("group-hover:visible");
    expect(card.className).toContain("group-focus-within:visible");
  });

  it("卡片里放收起态放不下的东西：条目号、逐句进度、跳过提示、上下条", () => {
    useAppStore.setState({ feedListen: sessionWith(1, 2) });
    render();
    const card = el("feed-player-card");
    expect(card.textContent).toContain("feed.listenPosition");
    expect(card.textContent).toContain('"index":2');
    expect(card.textContent).toContain('"total":2');
    expect(card.textContent).toContain("feed.listenSentence");
    expect(card.textContent).toContain("feed.listenSkipped");
    expect(card.textContent).toContain('"count":2');
    expect(el("feed-player-progress")).not.toBeNull();
  });

  it("首条时「上一条」禁用、末条时「下一条」禁用", () => {
    useAppStore.setState({ feedListen: sessionWith(0) });
    render();
    expect((el("feed-player-prev") as HTMLButtonElement).disabled).toBe(true);
    expect((el("feed-player-next") as HTMLButtonElement).disabled).toBe(false);
  });

  it("preparing 期间图标是「暂停」（点下去真的会挂起队列）", () => {
    useAppStore.setState({
      feedListen: { ...sessionWith(0), status: "preparing" },
    });
    render();
    expect(el("feed-player-toggle").getAttribute("aria-label")).toBe(
      "feed.listenPause",
    );
  });

  it("双向互斥：消息朗读开始 → 停收听；语音模式打开 → 停收听", () => {
    const stop = vi.fn();
    setFeedListenControllerForTests({
      getState: () => ({
        session: null,
        status: "idle",
        progress: null,
        skipped: 0,
      }),
      start: vi.fn(),
      toggle: vi.fn(),
      next: vi.fn(),
      prev: vi.fn(),
      stop,
    });
    useAppStore.setState({ feedListen: sessionWith(0) });
    render();

    act(() =>
      useAppStore.setState({
        readAloud: { ...useAppStore.getState().readAloud, status: "playing" },
      }),
    );
    expect(stop).toHaveBeenCalledTimes(1);

    act(() => useAppStore.setState({ voiceModeOpen: true }));
    expect(stop).toHaveBeenCalledTimes(2);
  });
});
