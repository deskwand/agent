// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TFunction } from "i18next";
import {
  toMicButtonProps,
  VoiceMicButton,
} from "../../renderer/components/VoiceMicButton";
import type { VoiceInputController } from "../../renderer/hooks/useVoiceInput";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}|${JSON.stringify(values)}` : key,
  }),
}));

let container: HTMLDivElement;
let root: Root;
const button = () => container.querySelector("button")!;
const buttonByLabel = (label: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label,
  );
/**
 * 带参数的文案在 `t` 桩里会多带一段 `|{...}`（见上面的 mock），所以按前缀取。
 * 安装态的 aria-label 就是带百分比的（`chat.voiceInstalling`），不能用全等。
 */
const buttonByLabelPrefix = (prefix: string) =>
  [...container.querySelectorAll("button")].find((b) =>
    b.getAttribute("aria-label")?.startsWith(prefix),
  );

function render(
  props: Partial<React.ComponentProps<typeof VoiceMicButton>> = {},
) {
  act(() => {
    root.render(
      <VoiceMicButton
        status="idle"
        level={0}
        seconds={0}
        install={null}
        onToggle={() => {}}
        onCancel={() => {}}
        {...props}
      />,
    );
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("VoiceMicButton", () => {
  it("空闲态显示开始文案，点击触发 toggle", () => {
    const onToggle = vi.fn();
    render({ onToggle });

    // 手动「整理 / 还原」删了：空闲态这一排只有麦克风一颗
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(button().getAttribute("aria-label")).toBe("chat.voiceStart");
    act(() => button().click());
    expect(onToggle).toHaveBeenCalled();
  });

  it("录音态显示计时、音量条与取消", () => {
    render({ status: "recording", seconds: 7, level: 0.5 });

    expect(container.textContent).toContain("0:07");
    expect(buttonByLabel("chat.voiceStop")).toBeDefined();
    expect(buttonByLabel("chat.voiceCancel")).toBeDefined();
  });

  it("请求权限与收尾中不允许再点", () => {
    for (const status of ["requesting", "finishing"] as const) {
      render({ status });
      expect(button().disabled).toBe(true);
    }
  });

  it("下载中：麦克风锁住，旁边给出百分比进度", () => {
    render({
      install: { phase: "downloading", percent: 45, installed: false },
    });

    const mic = buttonByLabelPrefix("chat.voiceInstalling")!;
    expect(mic.disabled).toBe(true);
    expect(container.textContent).toContain("45%");
    // 进度也进可访问名：读到的是「正在下载语音模型 45%」，不只是一个转圈。
    expect(mic.getAttribute("aria-label")).toBe(
      'chat.voiceInstalling|{"percent":45}',
    );
  });

  it("解压中也算忙（第二阶段，百分比接着走）", () => {
    render({ install: { phase: "extracting", percent: 92, installed: false } });

    expect(buttonByLabelPrefix("chat.voiceInstalling")!.disabled).toBe(true);
    expect(container.textContent).toContain("92%");
  });

  it("安装失败：给一行错误，麦克风仍可点（再点一次重试）", () => {
    render({ install: { phase: "error", percent: 0, installed: false } });

    expect(container.textContent).toContain("chat.voiceInstallFailed");
    expect(buttonByLabel("chat.voiceStart")!.disabled).toBe(false);
  });

  it("装好之后那一格不占地方", () => {
    render({ install: { phase: "ready", percent: 100, installed: true } });

    expect(container.textContent).not.toContain("%");
    expect(buttonByLabel("chat.voiceStart")!.disabled).toBe(false);
  });
});

const stubVoice: VoiceInputController = {
  status: "idle",
  level: 0,
  seconds: 0,
  toggle: () => {},
  cancel: () => {},
};

// 桩返回键名：断言的是「取了哪个键」，不是中文文案。
// i18next 的 TFunction 带 brand，测试桩只能显式断言（同 tool-helpers-web-access.test.ts）。
const keyT = ((key: string) => key) as unknown as TFunction;

const HOLD_KEY = "chat.voiceHoldKeyAltRightMac";

describe("toMicButtonProps 的快捷键条件", () => {
  it("引擎开着 + 有快捷键 → 键名按平台取", () => {
    const config = {
      enabled: true,
      shortcut: "AltSpace",
      autoPolish: true,
    } as const;
    expect(
      toMicButtonProps(stubVoice, null, {
        config,
        platform: "darwin",
        t: keyT,
      }).shortcutKeys,
    ).toBe("chat.voiceHoldKeyAltSpaceMac");
    expect(
      toMicButtonProps(stubVoice, null, {
        config,
        platform: "win32",
        t: keyT,
      }).shortcutKeys,
    ).toBe("chat.voiceHoldKeyAltSpaceWin");
  });

  it("引擎关 / 快捷键 disabled / 配置未加载 → 不提快捷键", () => {
    // 这三条与 usePushToTalk 的 enabled 条件同源：写了就是骗人。
    expect(
      toMicButtonProps(stubVoice, null, {
        config: { enabled: false, shortcut: "AltRight", autoPolish: true },
        platform: "darwin",
        t: keyT,
      }).shortcutKeys,
    ).toBeUndefined();
    expect(
      toMicButtonProps(stubVoice, null, {
        config: { enabled: true, shortcut: "disabled", autoPolish: true },
        platform: "darwin",
        t: keyT,
      }).shortcutKeys,
    ).toBeUndefined();
    expect(
      toMicButtonProps(stubVoice, null, {
        config: undefined,
        platform: "darwin",
        t: keyT,
      }).shortcutKeys,
    ).toBeUndefined();
  });
});

describe("可访问名不带键名", () => {
  it("带 shortcutKeys 时空闲态 aria-label 仍是纯动作", () => {
    render({ shortcutKeys: "chat.voiceHoldKeyAltRightMac" });
    expect(buttonByLabel("chat.voiceStart")!.getAttribute("aria-label")).toBe(
      "chat.voiceStart",
    );
  });

  it("不带 shortcutKeys 时同样是纯动作", () => {
    render();
    expect(buttonByLabel("chat.voiceStart")).toBeDefined();
  });
});

describe("气泡文案（聚焦可见）", () => {
  it("聚焦时把键名带出来，可访问名不变", async () => {
    render({ shortcutKeys: "chat.voiceHoldKeyAltRightMac" });
    const mic = buttonByLabel("chat.voiceStart")!;
    await act(async () => {
      mic.focus();
    });

    // 气泡走 portal 挂在 body 上，不在 container 里
    expect(document.body.querySelector('[role="tooltip"]')!.textContent).toBe(
      'chat.voiceStartWithShortcut|{"keys":"chat.voiceHoldKeyAltRightMac"}',
    );
    expect(mic.getAttribute("aria-label")).toBe("chat.voiceStart");
  });

  it("没有键名时停在名称", async () => {
    render();
    const mic = buttonByLabel("chat.voiceStart")!;
    await act(async () => {
      mic.focus();
    });

    expect(document.body.querySelector('[role="tooltip"]')!.textContent).toBe(
      "chat.voiceStart",
    );
  });

  it("录音中报「停止录音」，不提快捷键", async () => {
    render({ status: "recording", seconds: 3, shortcutKeys: HOLD_KEY });
    const mic = buttonByLabel("chat.voiceStop")!;
    await act(async () => {
      mic.focus();
    });

    expect(document.body.querySelector('[role="tooltip"]')!.textContent).toBe(
      "chat.voiceStop",
    );
  });

  it("收尾时麦克风锁着，气泡不报快捷键", async () => {
    // 这个态下 usePushToTalk 的 onStart 只认 idle：那颗键按下去没反应，
    // 写了就是假的。麦克风是 disabled，jsdom 里 focus() 不触发，只能直接派事件。
    render({ status: "requesting", shortcutKeys: HOLD_KEY });
    const mic = buttonByLabel("chat.voiceStart")!;
    expect(mic.disabled).toBe(true);
    await act(async () => {
      mic.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });

    expect(document.body.querySelector('[role="tooltip"]')!.textContent).toBe(
      "chat.voiceStart",
    );
  });
});
