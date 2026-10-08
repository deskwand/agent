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

import { FeedListenButton } from "../../renderer/components/FeedListenButton";
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

/** 假控制器：只记录 toggle 之类的调用 —— 不碰 AudioContext。 */
function fakeController() {
  const toggle = vi.fn();
  setFeedListenControllerForTests({
    getState: () => ({
      session: null,
      status: "idle",
      progress: null,
      skipped: 0,
    }),
    start: vi.fn(),
    toggle,
    next: vi.fn(),
    prev: vi.fn(),
    stop: vi.fn(),
  });
  return { toggle };
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
  act(() => root.render(<FeedListenButton />));
}

describe("FeedListenButton", () => {
  it("没有收听会话时不渲染这个图标", () => {
    render();
    expect(
      container.querySelector('[data-testid="feed-listen-widget"]'),
    ).toBeNull();
  });

  it("是 header 里的图标 + 下拉卡片（不再有右下角浮条）", () => {
    useAppStore.setState({ feedListen: sessionWith(0) });
    render();
    const widget = el("feed-listen-widget");
    // 图标容器与卡片自己都在拖拽区之外（否则点不动、还会拖窗）
    expect(widget.className).toContain("titlebar-no-drag");
    expect(el("feed-listen-button")).not.toBeNull();

    const card = el("feed-listen-card");
    expect(card.className).toContain("titlebar-no-drag");
    expect(card.className).toContain("invisible");
    expect(card.className).toContain("group-hover:visible");
    expect(card.className).toContain("group-focus-within:visible");
    expect(card.className).toContain("top-full");
    // 层级：盖过产物面板（z-50）但不盖灯箱（z-[100]）
    expect(card.className).toContain("z-[60]");
  });

  it("点图标会真的暂停（不是只改文案）", () => {
    const { toggle } = fakeController();
    useAppStore.setState({ feedListen: sessionWith(0) });
    render();
    act(() => {
      (el("feed-listen-button").closest("button") as HTMLButtonElement).click();
    });
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("卡片里放图标放不下的东西：条目号、逐句进度、跳过提示、上下条", () => {
    useAppStore.setState({ feedListen: sessionWith(1, 2) });
    render();
    const card = el("feed-listen-card");
    expect(card.textContent).toContain("feed.listenPosition");
    expect(card.textContent).toContain('"index":2');
    expect(card.textContent).toContain('"total":2');
    expect(card.textContent).toContain("feed.listenSentence");
    expect(card.textContent).toContain("feed.listenSkipped");
    expect(card.textContent).toContain('"count":2');
    expect(el("feed-listen-title").textContent).toBe("标题 B");
    expect(el("feed-listen-progress")).not.toBeNull();
  });

  it("首条时「上一条」禁用、末条时「下一条」禁用", () => {
    useAppStore.setState({ feedListen: sessionWith(0) });
    render();
    expect((el("feed-listen-prev") as HTMLButtonElement).disabled).toBe(true);
    expect((el("feed-listen-next") as HTMLButtonElement).disabled).toBe(false);
  });

  it("preparing 期间图标是「暂停」（点下去真的会挂起队列）", () => {
    useAppStore.setState({
      feedListen: { ...sessionWith(0), status: "preparing" },
    });
    render();
    expect(el("feed-listen-toggle").getAttribute("aria-label")).toBe(
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
