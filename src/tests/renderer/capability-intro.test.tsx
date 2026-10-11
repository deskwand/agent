// @vitest-environment jsdom
/**
 * 首屏那块「顺手装上本机能力」：显隐、折叠/展开、三行状态、跳过写标记。
 *
 * 两条断言来自 spec 的 Review Focus：三行都就绪时不该再出现下载按钮；
 * 写过 dismissedAt 之后整块不再渲染。
 *
 * 写法照 `src/tests/renderer/use-voice-engine.test.tsx`：jsdom + `react-dom/client`
 * （仓里没有 `@testing-library`）。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  voice: { getInstallState: vi.fn(), install: vi.fn(), onEvent: vi.fn() },
  tts: { getInstallState: vi.fn(), install: vi.fn(), onEvent: vi.fn() },
  ocr: { getInstallState: vi.fn(), install: vi.fn(), onEvent: vi.fn() },
  config: { save: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { CapabilityIntro } from "../../renderer/components/welcome/CapabilityIntro";
import { useAppStore } from "../../renderer/store";

const IDLE = { phase: "idle", percent: 0, installed: false };
const IDLE_TTS = { zh: IDLE, en: IDLE, matcha: IDLE };
const READY = { phase: "ready", percent: 100, installed: true };
const READY_TTS = { zh: READY, en: IDLE, matcha: IDLE };

let container: HTMLDivElement;
let root: Root;

const setConfig = (patch: Record<string, unknown>) =>
  useAppStore.getState().setAppConfig({
    voiceEngine: { enabled: false, shortcut: "AltRight" },
    ocr: { enabled: false },
    ...patch,
  } as never);

const render = async () => act(async () => root.render(<CapabilityIntro />));

const buttons = () => [...container.querySelectorAll("button")];
const testIds = () =>
  [...container.querySelectorAll("[data-testid]")].map((el) =>
    el.getAttribute("data-testid"),
  );

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  for (const mod of [api.voice, api.tts, api.ocr]) {
    mod.onEvent.mockImplementation(() => () => {});
  }
  api.voice.getInstallState.mockResolvedValue(IDLE);
  api.tts.getInstallState.mockResolvedValue(IDLE_TTS);
  api.ocr.getInstallState.mockResolvedValue(IDLE);
  // 真 `config.save` 返回的是**整份** AppConfig（不是刚写进去的那一小块）——
  // 替身也必须这样，否则写 dismissedAt 之后 store 里只剩它一个键，
  // 三行会当场退回"没开"（测试自己踩过）。
  api.config.save.mockImplementation(async (input: unknown) => ({
    config: {
      ...(useAppStore.getState().appConfig ?? {}),
      ...(input as Record<string, unknown>),
    },
  }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useAppStore.getState().setAppConfig(null);
  useAppStore.getState().setCapabilityGate({ prompt: null });
});

describe("首屏能力块", () => {
  it("默认折叠：只画一行，不画三行", async () => {
    setConfig({});
    await render();
    expect(container.textContent).toContain("capabilityIntro.collapsedLead");
    expect(container.textContent).not.toContain(
      "capabilityIntro.voiceInput.title",
    );
    expect(buttons().length).toBe(2); // 看看 / 不用了
  });

  it("点「看看」展开三行，并写 dismissedAt（只出现一次）", async () => {
    setConfig({});
    await render();
    await act(async () => buttons()[0].click());

    expect(container.textContent).toContain("capabilityIntro.voiceInput.title");
    expect(container.textContent).toContain("capabilityIntro.voice.title");
    expect(container.textContent).toContain("capabilityIntro.ocr.title");
    expect(api.config.save).toHaveBeenCalledWith({
      capabilityIntro: { dismissedAt: expect.any(Number) },
    });
  });

  it("点「不用了」：当场收起（写盘只保证下次不再出现）", async () => {
    setConfig({});
    await render();
    await act(async () => buttons()[1].click());
    expect(container.textContent).toBe("");
    expect(api.config.save).toHaveBeenCalledWith({
      capabilityIntro: { dismissedAt: expect.any(Number) },
    });
  });

  it("写过 dismissedAt 之后整块不渲染", async () => {
    setConfig({ capabilityIntro: { dismissedAt: 1728451200000 } });
    await render();
    expect(container.textContent).toBe("");
  });

  it("三行都已就绪：没有 enable 按钮，只有 ready 文案", async () => {
    api.voice.getInstallState.mockResolvedValue(READY);
    api.tts.getInstallState.mockResolvedValue(READY_TTS);
    api.ocr.getInstallState.mockResolvedValue(READY);
    setConfig({
      voiceEngine: { enabled: true, shortcut: "AltRight" },
      ocr: { enabled: true },
    });
    await render();
    await act(async () => buttons()[0].click());

    expect(testIds()).not.toContain("capability-enable-voiceInput");
    expect(testIds()).not.toContain("capability-enable-voice");
    expect(testIds()).not.toContain("capability-enable-ocr");
    expect(container.textContent).toContain("capabilityIntro.state.ready");
  });
});

it("下载中那一行：用的是 AppProgress（role=progressbar + aria-valuenow），不是手搓的条", async () => {
  api.voice.getInstallState.mockResolvedValue({
    phase: "downloading",
    percent: 42,
    installed: false,
  });
  setConfig({ voiceEngine: { enabled: true, shortcut: "AltRight" } });
  await render();
  await act(async () => buttons()[0].click());

  const bar = container.querySelector('[role="progressbar"]');
  expect(bar).not.toBeNull();
  expect(bar?.getAttribute("aria-valuenow")).toBe("42");
  expect(bar?.getAttribute("aria-valuemax")).toBe("100");
  expect(container.textContent).toContain("capabilityIntro.state.downloading");
});
