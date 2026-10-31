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
        install={null}
        onToggle={() => {}}
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

  it("录音态是同一颗按钮：停止方块 + 呼吸环，几何不变", () => {
    render({ status: "recording" });

    // 那一格只有一个控件，它就是停止按钮
    expect(container.querySelectorAll("button")).toHaveLength(1);
    const stop = buttonByLabel("chat.voiceStop")!;
    expect(stop.disabled).toBe(false);
    expect(stop.className).toContain("text-destructive");

    const ring = container.querySelector(
      '[data-testid="voice-recording-ring"]',
    )!;
    expect(ring).not.toBeNull();
    // 环的观感全靠这两条类名。jsdom 不看样式，而 tailwind 的刻度陷阱
    // （例如 opacity-55 不在默认刻度里）会让类名照旧存在、CSS 一条都不产出 ——
    // 断言字符串是这里唯一能拦住那次静默降级的手段。
    expect(ring.className).toContain("animate-voice-polish-ring");
    expect(ring.className).toContain("border-destructive");
  });

  it("录音态不在按钮里显示计时或波形", () => {
    render({ status: "recording" });

    // 计时与波形在卡片内的 VoiceRecordingStrip：36px 装不下它们
    expect(container.textContent).not.toMatch(/\d+:\d\d/);
    expect(
      container.querySelectorAll('[data-testid="voice-level-bar"]'),
    ).toHaveLength(0);
  });

  it("收尾期间按钮还在但锁住", () => {
    render({ status: "finishing" });

    expect(buttonByLabel("chat.voiceStop")!.disabled).toBe(true);
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });

  it("录音开始/结束都不把键盘焦点甩掉（同一个按钮原地变形）", () => {
    render();
    act(() => button().focus());
    expect(document.activeElement).toBe(button());

    // 换成停止方块也不能是另一个元素：键盘用户按空格开始录音后，焦点得留在原地
    render({ status: "recording" });
    expect(document.activeElement).toBe(container.querySelector("button"));
    expect(button().getAttribute("aria-label")).toBe("chat.voiceStop");

    render({ status: "idle" });
    expect(document.activeElement).toBe(container.querySelector("button"));
  });

  it("请求权限与收尾中不允许再点", () => {
    for (const status of ["requesting", "finishing"] as const) {
      render({ status });
      expect(button().disabled).toBe(true);
    }
  });

  it("下载中：不算第二颗控件，进度进环形图标与可访问名", () => {
    render({
      install: { phase: "downloading", percent: 45, installed: false },
    });

    // 那一格任何时候只有一颗按钮：进度条与百分比都已收进按钮里
    expect(container.querySelectorAll("button")).toHaveLength(1);
    const mic = buttonByLabelPrefix("chat.voiceInstalling")!;
    expect(mic.disabled).toBe(true);
    expect(mic.getAttribute("aria-label")).toBe(
      'chat.voiceInstalling|{"percent":45}',
    );
    // 环形进度的弧：45% 时 dashoffset 落在 55% 处，不是满弧也不是空弧
    const arc = mic.querySelector('[data-testid="voice-install-arc"]')!;
    expect(Number(arc.getAttribute("stroke-dashoffset"))).toBeCloseTo(
      Number(arc.getAttribute("stroke-dasharray")) * 0.55,
      0,
    );
  });

  it("解压中也算忙（第二阶段，百分比接着走）", () => {
    render({ install: { phase: "extracting", percent: 92, installed: false } });

    expect(buttonByLabelPrefix("chat.voiceInstalling")!.disabled).toBe(true);
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });

  it("安装失败：红图标 + 气泡说清，麦克风仍可点（再点一次重试）", () => {
    render({ install: { phase: "error", percent: 0, installed: false } });

    expect(container.querySelectorAll("button")).toHaveLength(1);
    const mic = buttonByLabel("chat.voiceInstallFailedRetry")!;
    expect(mic.disabled).toBe(false);
    expect(mic.querySelector("svg")).not.toBeNull();
    expect(mic.className).toContain("text-destructive");
    // 失败文案不再占一行红字：它进了可访问名与气泡
    expect(container.textContent).not.toContain("chat.voiceInstallFailed");
  });

  it("任何状态都是 36×36：永不变宽", () => {
    const states: Array<Partial<React.ComponentProps<typeof VoiceMicButton>>> =
      [
        {},
        { status: "requesting" },
        { status: "recording" },
        { status: "finishing" },
        { polishing: true },
        { blocked: true },
        { install: { phase: "downloading", percent: 45, installed: false } },
        { install: { phase: "extracting", percent: 92, installed: false } },
        { install: { phase: "error", percent: 0, installed: false } },
        { install: { phase: "ready", percent: 100, installed: true } },
      ];

    for (const props of states) {
      render(props);
      const tokens = button().className.split(/\s+/);
      expect(tokens).toContain("h-9");
      expect(tokens).toContain("w-9");
      expect(tokens).toContain("shrink-0");
      // ⚠️ 只钉「会变宽」的那几种写法。`px-4` / `py-2` 来自 Button 的默认尺寸档，
      // 在 w-9 + border-box 下不产生实际宽度，钉它们只会得到一条假红。
      expect(tokens).not.toContain("px-2.5");
      expect(tokens).not.toContain("h-8");
      expect(tokens.filter((t) => /^(min-w-|max-w-|w-\[)/.test(t))).toEqual([]);
    }
  });

  it("装好之后那一格不占地方", () => {
    render({ install: { phase: "ready", percent: 100, installed: true } });

    expect(container.textContent).not.toContain("%");
    expect(buttonByLabel("chat.voiceStart")!.disabled).toBe(false);
  });

  it("别人在录时整粒禁用，气泡说清是另一处在录", () => {
    const onToggle = vi.fn();

    render({ blocked: true, onToggle });

    expect(button().disabled).toBe(true);
    expect(button().getAttribute("aria-label")).toBe("chat.voiceBusyElsewhere");
    act(() => button().click());
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("整理中：外圈画呼吸环、可访问名报「正在整理」，麦克风仍可点", () => {
    render({ polishing: true });

    const ring = container.querySelector('[data-testid="voice-polish-ring"]');
    expect(ring).not.toBeNull();
    // 环的观感全靠这两条类名。jsdom 不看样式，而 tailwind 的刻度陷阱
    // （例如 opacity-55 不在默认刻度里）会让类名照旧存在、CSS 一条都不产出 ——
    // 断言字符串是这里唯一能拦住那次静默降级的手段。
    expect(ring!.className).toContain("animate-voice-polish-ring");
    expect(ring!.className).toContain("opacity-[0.55]");
    // 状态进可访问名（同安装态的约定）；麦克风没被锁：整理期间仍能按下去说话
    const mic = buttonByLabel("chat.voicePolishing")!;
    expect(mic.disabled).toBe(false);
  });

  const occupiedSlots: Array<
    [string, Partial<React.ComponentProps<typeof VoiceMicButton>>]
  > = [
    ["录音中", { status: "recording" }],
    ["请求权限中", { status: "requesting" }],
    ["收尾中", { status: "finishing" }],
    [
      "下载模型中",
      {
        install: {
          phase: "downloading" as const,
          percent: 45,
          installed: false,
        },
      },
    ],
    [
      "解压中",
      {
        install: {
          phase: "extracting" as const,
          percent: 92,
          installed: false,
        },
      },
    ],
    [
      "安装失败",
      { install: { phase: "error" as const, percent: 0, installed: false } },
    ],
  ];

  it.each(occupiedSlots)("那一格已经有人：%s 时不画环", (_label, props) => {
    render({ polishing: true, ...props });

    expect(
      container.querySelector('[data-testid="voice-polish-ring"]'),
    ).toBeNull();
  });

  it("不传 polishing 就不画环（替身只填录音那几项）", () => {
    render();

    expect(
      container.querySelector('[data-testid="voice-polish-ring"]'),
    ).toBeNull();
  });
});

const stubVoice: VoiceInputController = {
  status: "idle",
  level: 0,
  seconds: 0,
  polishing: false,
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
      toMicButtonProps(
        stubVoice,
        null,
        {
          config,
          platform: "darwin",
          t: keyT,
        },
        false,
      ).shortcutKeys,
    ).toBe("chat.voiceHoldKeyAltSpaceMac");
    expect(
      toMicButtonProps(
        stubVoice,
        null,
        {
          config,
          platform: "win32",
          t: keyT,
        },
        false,
      ).shortcutKeys,
    ).toBe("chat.voiceHoldKeyAltSpaceWin");
  });

  it("引擎关 / 快捷键 disabled / 配置未加载 → 不提快捷键", () => {
    // 这三条与 usePushToTalk 的 enabled 条件同源：写了就是骗人。
    expect(
      toMicButtonProps(
        stubVoice,
        null,
        {
          config: { enabled: false, shortcut: "AltRight", autoPolish: true },
          platform: "darwin",
          t: keyT,
        },
        false,
      ).shortcutKeys,
    ).toBeUndefined();
    expect(
      toMicButtonProps(
        stubVoice,
        null,
        {
          config: { enabled: true, shortcut: "disabled", autoPolish: true },
          platform: "darwin",
          t: keyT,
        },
        false,
      ).shortcutKeys,
    ).toBeUndefined();
    expect(
      toMicButtonProps(
        stubVoice,
        null,
        {
          config: undefined,
          platform: "darwin",
          t: keyT,
        },
        false,
      ).shortcutKeys,
    ).toBeUndefined();
  });

  it("透传 polishing", () => {
    expect(
      toMicButtonProps(
        { ...stubVoice, polishing: true },
        null,
        {
          config: undefined,
          platform: "darwin",
          t: keyT,
        },
        false,
      ).polishing,
    ).toBe(true);
  });

  it("透传 blocked", () => {
    expect(
      toMicButtonProps(
        stubVoice,
        null,
        { config: undefined, platform: "darwin", t: keyT },
        true,
      ).blocked,
    ).toBe(true);
    expect(
      toMicButtonProps(
        stubVoice,
        null,
        { config: undefined, platform: "darwin", t: keyT },
        false,
      ).blocked,
    ).toBe(false);
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

  it("录音中报「停止录音 · Esc 取消」，不提快捷键", async () => {
    render({ status: "recording", shortcutKeys: HOLD_KEY });
    const mic = buttonByLabel("chat.voiceStop")!;
    await act(async () => {
      mic.focus();
    });

    expect(document.body.querySelector('[role="tooltip"]')!.textContent).toBe(
      "chat.voiceStopWithEsc",
    );
  });

  it("整理中报「正在整理」", async () => {
    render({ polishing: true });
    const mic = buttonByLabel("chat.voicePolishing")!;
    await act(async () => {
      mic.focus();
    });

    expect(document.body.querySelector('[role="tooltip"]')!.textContent).toBe(
      "chat.voicePolishing",
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
