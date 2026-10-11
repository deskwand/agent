// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import { MessageCard } from "../../renderer/components/MessageCard";
import type { Message } from "../../renderer/types";
import type { EnsureOutcome } from "../../renderer/capabilities/capability-gate";
import { useAppStore } from "../../renderer/store";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 朗读收成一个图标（2026-10-10 用户裁决：播放中点=暂停、暂停中点=继续；去掉停止键与进度文字）。
 *
 * hook 用 mock：真 controller 是模块级单例 + 真 AudioContext + 主进程桥，jsdom 里起不来；
 * 本轮判据全在「哪些键在场、点它调谁、读屏听到什么」这一层。
 * ⚠️ 工厂必须带 `stopReadAloud`：`store/index.ts:203` 在模块加载期就 import 它
 * （`useVoiceMode.ts:29` 亦然），少一个导出会让整条 import 链在 beforeEach 之前炸掉。
 */
const h = vi.hoisted(() => ({
  reader: {
    messageId: null as string | null,
    status: "idle" as "idle" | "preparing" | "playing" | "paused" | "error",
    currentIndex: 0,
    total: 30,
    start: vi.fn(),
    toggle: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock("../../renderer/hooks/useReadAloud", () => ({
  useReadAloud: () => h.reader,
  stopReadAloud: vi.fn(),
}));

/**
 * 能力门也用替身：本文件判的是「这颗键点下去调谁」，不是「缺不缺模型」
 * （门自己有两处测试：`capabilities/capability-gate.test.ts` + `voice/read-aloud-gate.test.ts`）。
 * 默认 ready = 已装好，按下即读；两条新用例把它调成 cancelled 看"先装再读"那一路。
 */
const g = vi.hoisted(() => ({
  gate: {
    // 类型必须写形状不能用 `as const` 收窄：后面要 mockResolvedValue("cancelled")。
    ensureReady: vi.fn<() => Promise<EnsureOutcome>>(async () => "ready"),
    whenReady: vi.fn<() => Promise<void>>(async () => {}),
  },
}));
// 替身点是**模块**（MessageCard 取的是 `getCapabilityGate()` 的动作，不订阅状态）。
vi.mock("../../renderer/capabilities/capability-gate", () => ({
  getCapabilityGate: () => ({
    ensureReady: g.gate.ensureReady,
    whenReady: g.gate.whenReady,
  }),
}));

const message: Message = {
  id: "m1",
  role: "assistant",
  sessionId: "s1",
  content: [{ type: "text", text: "Hello world." }],
  timestamp: Date.now(),
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // 锁英文，断言文案稳定（仓库先例：message-card-action-bar.test.ts）
  window.localStorage.setItem("i18nextLng", "en");
  Object.assign(h.reader, {
    messageId: null,
    status: "idle",
    currentIndex: 0,
    total: 30,
  });
  h.reader.start.mockClear();
  h.reader.toggle.mockClear();
  h.reader.stop.mockClear();
  g.gate.ensureReady.mockReset().mockResolvedValue("ready");
  g.gate.whenReady.mockReset().mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  // ⚠️ 卸载会调 reader.stop()（MessageCard 的卸载 effect）⇒ 所有断言都写在卸载之前
  act(() => root.unmount());
  container.remove();
});

/** ⚠️ 每次传**新对象**：`MessageCard` 是 `memo`（无自定义比较器），props 浅相等会直接 bailout
 *  ⇒ 用同一个 `message` 常量重复 render，状态改了 DOM 也不动。
 *  传新对象不会触发卸载 effect（它的 deps 是 `[message.id]`，id 没变）⇒ 不会误调 stop()。 */
function renderCard() {
  act(() => {
    root.render(
      React.createElement(MessageCard, {
        message: { ...message },
        isLatestRound: true,
      }),
    );
  });
}

function readAloudButton(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    '[data-testid="read-aloud-button"]',
  );
  expect(button, "朗读键必须在场").not.toBeNull();
  return button!;
}

describe("朗读收成一个图标", () => {
  it("播放中：只有那一个键，停止键与「第 X / Y 句」都不在", () => {
    h.reader.messageId = "m1";
    h.reader.status = "playing";
    renderCard();

    // 正文只有 text 块 ⇒ 卡里没有别的朗读字形。若 fixture 以后加 tool 块会假红：
    // `ProcessSummaryBlock.tsx:51` 与 `toolHelpers.tsx:52,54` 也用 Volume2 ⇒ 那时改用按钮内计数。
    const glyphs = [...container.querySelectorAll("svg")].filter((svg) =>
      /lucide-(volume-2|pause|play|loader-circle)/.test(
        svg.getAttribute("class") ?? "",
      ),
    );
    expect(glyphs).toHaveLength(1);
    expect(
      container.querySelector('[data-testid="stop-reading-button"]'),
    ).toBeNull();
    // readAloudProgress 的英文文案是 "Sentence {{current}} / {{total}}"
    expect(container.textContent).not.toContain("Sentence");
  });

  it("四个状态各是哪个字形（且键内只有一个 svg）", () => {
    const cases = [
      { status: "idle", reading: false, glyph: ".lucide-volume-2" },
      { status: "preparing", reading: true, glyph: ".lucide-loader-circle" },
      { status: "playing", reading: true, glyph: ".lucide-pause" },
      { status: "paused", reading: true, glyph: ".lucide-play" },
      { status: "error", reading: true, glyph: ".lucide-volume-2" },
    ] as const;
    for (const { status, reading, glyph } of cases) {
      h.reader.messageId = reading ? "m1" : null;
      h.reader.status = status;
      renderCard();
      const button = readAloudButton();
      expect(
        button.querySelector(glyph),
        `${status} ⇒ ${glyph}`,
      ).not.toBeNull();
      expect(
        button.querySelectorAll("svg"),
        `${status} 键内只应有一个字形`,
      ).toHaveLength(1);
    }
  });

  it("播放/暂停二态：点它走 toggle，永不碰 stop", async () => {
    // ① 没在读 → 先过能力门（异步），门说 ready 就 start(messageId, 正文容器)
    renderCard();
    await act(async () => readAloudButton().click());
    expect(h.reader.start).toHaveBeenCalledTimes(1);
    expect(h.reader.start.mock.calls[0][0]).toBe("m1");
    expect(h.reader.toggle).not.toHaveBeenCalled();
    expect(h.reader.stop).not.toHaveBeenCalled();

    // ② 播放中 → toggle（暂停）
    h.reader.messageId = "m1";
    h.reader.status = "playing";
    renderCard();
    act(() => readAloudButton().click());
    expect(h.reader.toggle).toHaveBeenCalledTimes(1);
    expect(h.reader.stop).not.toHaveBeenCalled();

    // ③ 暂停中 → 还是 toggle（继续），既不重新 start、也不 stop
    h.reader.status = "paused";
    renderCard();
    act(() => readAloudButton().click());
    expect(h.reader.toggle).toHaveBeenCalledTimes(2);
    expect(h.reader.start).toHaveBeenCalledTimes(1);
    expect(h.reader.stop).not.toHaveBeenCalled();
    // ⚠️ 这里能断言 stop 为 0，是因为正文一个字没变、`startKeyRef` 与当前正文一致
    // ⇒ 正文变化那条 effect 不会触发 stop。若你改了 message.content，这条会假红。
  });

  it("两条死路补齐：preparing 点一下取消，error 点一下重试", async () => {
    // preparing：首块音频还没到，`toggle()` 是 no-op ⇒ 这一下必须是 stop（旧版此时有停止键）
    h.reader.messageId = "m1";
    h.reader.status = "preparing";
    renderCard();
    act(() => readAloudButton().click());
    expect(h.reader.stop).toHaveBeenCalledTimes(1);
    expect(h.reader.toggle).not.toHaveBeenCalled();
    expect(h.reader.start).not.toHaveBeenCalled();

    // error：图标已回落成音量、tooltip 写着「朗读这条回复」⇒ 这一下必须是 start（重试）
    h.reader.status = "error";
    renderCard();
    await act(async () => readAloudButton().click());
    expect(h.reader.start).toHaveBeenCalledTimes(1);
    expect(h.reader.start.mock.calls[0][0]).toBe("m1");
    expect(h.reader.toggle).not.toHaveBeenCalled();
  });

  it("读屏名随状态变（tooltip 不是 accessible name）", () => {
    const cases = [
      { status: "idle", reading: false, label: "Read this reply" },
      { status: "preparing", reading: true, label: "Stop" },
      { status: "playing", reading: true, label: "Pause" },
      { status: "paused", reading: true, label: "Resume" },
    ] as const;
    for (const { status, reading, label } of cases) {
      h.reader.messageId = reading ? "m1" : null;
      h.reader.status = status;
      renderCard();
      expect(readAloudButton().getAttribute("aria-label"), status).toBe(label);
    }
  });

  it("错误态仍留指路文案（它不是控件，是本轮唯一保留的文字）", () => {
    h.reader.messageId = "m1";
    h.reader.status = "error";
    renderCard();

    expect(container.textContent).toContain("Read aloud failed");
    expect(
      container.querySelector('[data-testid="stop-reading-button"]'),
    ).toBeNull();
  });
});

it("缺语音模型：这一下不读，弹确认；装好之后条件成立才自动开始", async () => {
  g.gate.ensureReady.mockResolvedValue("cancelled");
  let release!: () => void;
  g.gate.whenReady.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  renderCard();
  await act(async () => {
    readAloudButton().click();
  });
  // 确认弹窗已经摆出来，但这一下不读
  expect(h.reader.start).not.toHaveBeenCalled();

  // 装好了 → 四条护栏都成立 → 自动开始
  await act(async () => release());
  expect(h.reader.start).toHaveBeenCalledTimes(1);
  expect(h.reader.start.mock.calls[0][0]).toBe("m1");
});

it("正在装 / 装失败：什么都不做（既不读，也不去弹第二个窗）", async () => {
  for (const outcome of ["busy", "failed", "unsupported"] as const) {
    h.reader.start.mockClear();
    g.gate.ensureReady.mockResolvedValue(outcome);
    renderCard();
    await act(async () => {
      readAloudButton().click();
    });
    expect(h.reader.start).not.toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
});

it("装好了但护栏不成立（期间用户读了别的）：不自动出声，改发一条「再点一次」", async () => {
  g.gate.ensureReady.mockResolvedValue("cancelled");
  let release!: () => void;
  g.gate.whenReady.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  renderCard();
  await act(async () => {
    readAloudButton().click();
  });

  // 等待期间用户去读了别的消息：`noReadStartedSince` 不成立
  h.reader.messageId = "m2";
  await act(async () => release());

  expect(h.reader.start).not.toHaveBeenCalled();
  expect(useAppStore.getState().globalNotice?.messageKey).toBe(
    "messageCard.readAloudReadyAgain",
  );
  h.reader.messageId = null;
});
