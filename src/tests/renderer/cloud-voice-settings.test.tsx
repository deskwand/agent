// @vitest-environment jsdom
/**
 * 「语音」卡的**来源=云端**分支：端点/凭据/音色/状态/高级五行随 provider 变。
 *
 * harness 与 `voice-mode-settings.test.tsx` 同款（jsdom + fake electronAPI +
 * `t` 回键名，所以断言看的是 i18n **键**，不是文案）。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../renderer/types";

const api = vi.hoisted(() => {
  const tts = {
    getInstallState: vi.fn(),
    getEngineState: vi.fn(),
    onEvent: vi.fn(),
    install: vi.fn(),
    removeInstall: vi.fn(),
    preview: vi.fn(),
  };
  const config = { save: vi.fn() };
  (window as unknown as { electronAPI: unknown }).electronAPI = { tts, config };
  return { tts, config };
});

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { VoiceModeSettings } from "../../renderer/components/settings/VoiceModeSettings";
import { pickOption } from "./settings-menu-helper";
import { useAppStore } from "../../renderer/store";

let container: HTMLDivElement;
let root: Root;

const IDLE = { phase: "idle", percent: 0, installed: false } as const;

const byTestId = (id: string) =>
  container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

async function mount(voiceMode: Record<string, unknown>): Promise<void> {
  useAppStore.getState().setAppConfig({ voiceMode } as unknown as AppConfig);
  await act(async () => {
    root.render(<VoiceModeSettings />);
  });
}

const cloudMode = (cloud: Record<string, unknown>) => ({
  silenceMs: 1200,
  fastVoice: true,
  tone: "balanced",
  source: "cloud",
  cloud,
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
  api.tts.getInstallState.mockResolvedValue({
    zh: IDLE,
    en: IDLE,
    matcha: IDLE,
  });
  api.tts.getEngineState.mockResolvedValue({ ...IDLE, status: "idle" });
  api.tts.onEvent.mockImplementation(() => () => {});
  api.config.save.mockImplementation(async (patch: Partial<AppConfig>) => ({
    config: { ...useAppStore.getState().appConfig, ...patch } as AppConfig,
  }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useAppStore.getState().setAppConfig(null);
  vi.unstubAllGlobals();
});

describe("来源行", () => {
  it("本机时显示音质行、没有云端块；拨到云端后反过来", async () => {
    await mount({ silenceMs: 1200, fastVoice: true, tone: "balanced" });
    expect(byTestId("voice-voice-tone")).not.toBeNull();
    expect(byTestId("cloud-endpoint")).toBeNull();

    await pickOption(container, "voice-source-select", "cloud");
    expect(byTestId("cloud-endpoint")).not.toBeNull();
    expect(byTestId("voice-voice-tone")).toBeNull();
  });
});

describe("云端块随 provider 变", () => {
  it("豆包：凭据标签是 doubaoKey、提示带 warn、音色是下拉、展示只读档位映射", async () => {
    await mount(
      cloudMode({
        provider: "doubao",
        voiceId: "zh_female_vv_uranus_bigtts",
        credentials: { doubao: { apiKey: "k" } },
      }),
    );
    expect(byTestId("cloud-credential")?.textContent).toContain(
      "cloud.doubaoKey",
    );
    expect(byTestId("cloud-credential")?.textContent).toContain(
      "cloud.hintDoubao",
    );
    // 有策展音色 → 下拉；无 → 手填输入
    expect(byTestId("cloud-voice-select")).not.toBeNull();
    expect(byTestId("cloud-voice-input")).toBeNull();

    await act(async () => {
      byTestId("cloud-advanced-toggle")!.click();
    });
    expect(byTestId("cloud-tier-declared-text")?.textContent).toContain(
      "seed-tts-2.0-expressive",
    );
    // 声明式映射是只读的：不许出现模型输入框
    expect(byTestId("cloud-model-input")).toBeNull();
  });

  it("通用端点：有预设下拉与 BaseURL、音色手填、高级里是模型输入框", async () => {
    await mount(
      cloudMode({
        provider: "openai-compatible",
        baseUrl: "https://api.openai.com/v1",
        credentials: { "openai-compatible": { apiKey: "k" } },
      }),
    );
    expect(byTestId("cloud-preset-select")).not.toBeNull();
    expect(byTestId("cloud-baseurl-input")).not.toBeNull();
    expect(byTestId("cloud-voice-input")).not.toBeNull();
    expect(byTestId("cloud-voice-select")).toBeNull();

    await act(async () => {
      byTestId("cloud-advanced-toggle")!.click();
    });
    expect(byTestId("cloud-model-input")).not.toBeNull();
    expect(byTestId("cloud-tier-declared-text")).toBeNull();
  });
});

describe("状态徽标", () => {
  it("缺凭据 → unconfigured；齐了 → ready", async () => {
    await mount(cloudMode({ provider: "doubao", voiceId: "v" }));
    expect(byTestId("cloud-status-badge")?.textContent).toContain(
      "cloud.state.unconfigured",
    );

    await act(async () => {
      root.unmount();
    });
    root = createRoot(container);
    await mount(
      cloudMode({
        provider: "doubao",
        voiceId: "v",
        credentials: { doubao: { apiKey: "k" } },
      }),
    );
    expect(byTestId("cloud-status-badge")?.textContent).toContain(
      "cloud.state.ready",
    );
  });
});

describe("写入语义", () => {
  it("连续两次改动不互相覆盖（按函数更新，不是渲染快照）", async () => {
    await mount(
      cloudMode({
        provider: "openai-compatible",
        baseUrl: "https://api.openai.com/v1",
      }),
    );
    const input = byTestId("cloud-credential-input") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "sk-1");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const saved = api.config.save.mock.calls.at(-1)?.[0] as
      | { voiceMode?: { cloud?: { baseUrl?: string; credentials?: unknown } } }
      | undefined;
    // 写的是凭据，baseUrl 必须还在（快照式更新会把它抹掉）
    expect(saved?.voiceMode?.cloud?.baseUrl).toBe("https://api.openai.com/v1");
    expect(saved?.voiceMode?.cloud?.credentials).toBeDefined();
  });
});

/**
 * 状态徽标必须说真话：它显示的那个音色就是实际会用的那个。
 * 旧实现里「没显式选音色」会被报成「未配置凭据」——凭据明明填好了。
 */
describe("状态与默认音色", () => {
  it("有凭据、没显式选音色、端点有策展音色 → ready（界面显示的就是会用的）", async () => {
    await mount(
      cloudMode({
        provider: "doubao",
        credentials: { doubao: { apiKey: "k" } },
      }),
    );
    expect(byTestId("cloud-status-badge")?.textContent).toContain(
      "cloud.state.ready",
    );
    expect(byTestId("cloud-preview-error")).toBeNull();
  });

  it("有凭据但音色为空且端点没有策展表 → 说「未选择音色」，不是「未配置凭据」", async () => {
    await mount(
      cloudMode({
        provider: "openai-compatible",
        baseUrl: "https://api.openai.com/v1",
        credentials: { "openai-compatible": { apiKey: "k" } },
      }),
    );
    expect(byTestId("cloud-status-badge")?.textContent).toContain(
      "cloud.state.noVoice",
    );
  });
});

/**
 * 试听失败时**不能只给映射文案**：`failed` 那一类的可行动信息全在端点原话里
 * （例如豆包的 `55000000 resource ID is mismatched…`）。这条用例就是这次踩坑的护栏。
 */
describe("试听失败的展示", () => {
  it("四类文案 + 端点原话都给（原话里有可行动信息）", async () => {
    api.tts.preview.mockResolvedValue({
      ok: false,
      error:
        "failed: doubao 55000000: resource ID is mismatched with speaker related resource",
      code: "failed",
    });
    await mount(
      cloudMode({
        provider: "doubao",
        credentials: { doubao: { apiKey: "k" } },
      }),
    );
    await act(async () => {
      byTestId("cloud-preview-button")!.click();
    });
    await act(async () => {}); // 让 play() 的 await 落地

    expect(byTestId("cloud-preview-error")?.textContent).toContain(
      "cloud.error.failed",
    );
    expect(byTestId("cloud-preview-detail")?.textContent).toContain("55000000");
  });
});
