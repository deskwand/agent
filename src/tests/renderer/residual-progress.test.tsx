// @vitest-environment jsdom
//
// 残余手绘进度条的收口测试（Task 10）。
//
// 四个调用点过去各自画 `<div style={{width:`${percent}%`}}>`：没有夹紧、没有名称、
// 也没有区间语义。这里把它们统一钉在 AppProgress 上，另外钉住三件容易回归的事：
//   1. 调用点传的是**领域值**（42 表示 42%），AppProgress 内部换算 —— 再次换算会变成
//      0.42% 或 99.58% 的位移，二者都不会让类型检查变红；
//   2. `progress.progress` / `contextUsagePercentage` / `window.usedPercent` 本来就是
//      百分比，`max` 必须是 100；
//   3. SettingsAbout 的条**只在 downloading 态**存在。
// 仓库没有 @testing-library/*，所以名称按 ARIA 的规则自己算（aria-label 优先，
// 其次解析 aria-labelledby 指向节点的文本）。

import "../../renderer/i18n/config";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstallProgress } from "../../renderer/components/settings/shared";
import { SettingsAbout } from "../../renderer/components/settings/SettingsAbout";
import { SandboxSetupDialog } from "../../renderer/components/SandboxSetupDialog";
import { StatusPopover } from "../../renderer/components/StatusPopover";
import { useAppStore } from "../../renderer/store";
import type { SandboxSetupProgress, ServerEvent } from "../../renderer/types";

let container: HTMLDivElement;
let root: Root;
/** SettingsAbout 用 window.electronAPI.on 订阅主进程事件；存下来精确投递。 */
let emit: (event: ServerEvent) => void;

function render(node: ReactNode) {
  act(() => root.render(node));
}

async function renderAsync(node: ReactNode) {
  await act(async () => root.render(node));
}

/** 与 dom-accessibility-api 同口径：aria-label → aria-labelledby → 可见文本。 */
function accessibleName(el: Element): string {
  const label = el.getAttribute("aria-label");
  if (label) return label;
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    return labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
  }
  return (el.textContent ?? "").trim();
}

/** 四处都可能经 Portal 落到 body，所以统一从 body 查。 */
function bars(): HTMLElement[] {
  return [
    ...document.body.querySelectorAll<HTMLElement>('[role="progressbar"]'),
  ];
}

function barNamed(name: string): HTMLElement {
  const bar = bars().find((el) => accessibleName(el) === name);
  expect(bar, `没找到名为「${name}」的 progressbar`).not.toBeUndefined();
  return bar!;
}

function fillOf(bar: Element): string {
  return bar.querySelector("div")?.getAttribute("style") ?? "";
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // 这条链上的文案走 i18n；jsdom 的 navigator.language 是 en-US，不强制就拿到英文。
  const i18n = (await import("../../renderer/i18n/config")).default;
  await i18n.changeLanguage("zh");

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document
    .querySelectorAll('[role="dialog"], [role="alertdialog"]')
    .forEach((el) => el.remove());
  document
    .querySelectorAll("[data-radix-popper-content-wrapper]")
    .forEach((el) => el.remove());
  delete (window as { electronAPI?: unknown }).electronAPI;
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  vi.unstubAllGlobals();
});

describe("InstallProgress（设置卡片里的安装条）", () => {
  it("42% 落成 42/100，位移按 58% 算（不是 100 − 42，也不是 0.42%）", () => {
    render(<InstallProgress percent={42} testId="install" />);

    // 外层 testId 与布局是调用方契约，不能被包装层吃掉。
    const outer = container.querySelector('[data-testid="install"]');
    expect(outer).not.toBeNull();
    expect(outer!.className).toContain("px-4");

    const bar = outer!.querySelector<HTMLElement>('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(bar.getAttribute("aria-valuenow")).toBe("42");
    expect(accessibleName(bar)).toBe("下载进度");
    // 轨道色是既有 token，不是 vendored 的 bg-primary/20。
    expect(bar.className).toContain("bg-accent");
    expect(bar.className).not.toContain("bg-primary/20");

    expect(fillOf(bar)).toContain("translateX(-58%)");
    expect(fillOf(bar)).not.toContain("translateX(-99.58%)");
  });

  it("越界值夹紧到区间内（旧实现会把 120 直接写进 aria-valuenow）", () => {
    render(<InstallProgress percent={120} testId="install" />);
    expect(
      container
        .querySelector('[role="progressbar"]')!
        .getAttribute("aria-valuenow"),
    ).toBe("100");

    render(<InstallProgress percent={-5} testId="install" />);
    expect(
      container
        .querySelector('[role="progressbar"]')!
        .getAttribute("aria-valuenow"),
    ).toBe("0");
  });
});

describe("SettingsAbout（关于页的更新下载条）", () => {
  function stubBridge() {
    window.electronAPI = {
      send: vi.fn(),
      openExternal: vi.fn().mockResolvedValue(true),
      on: (handler: (event: ServerEvent) => void) => {
        emit = handler;
        return () => {};
      },
    } as never;
  }

  it("未进入下载态时根本没有 progressbar", async () => {
    stubBridge();
    await renderAsync(<SettingsAbout appVersion="1.0.47" />);

    expect(bars()).toHaveLength(0);
  });

  it("下载态出现，值为下载百分比（max=100），名称指向可见的下载说明", async () => {
    stubBridge();
    await renderAsync(<SettingsAbout appVersion="1.0.47" />);

    await act(async () => {
      emit({
        type: "update.progress",
        payload: {
          percent: 42,
          bytesPerSecond: 0,
          transferred: 0,
          total: 0,
        },
      });
    });

    expect(bars()).toHaveLength(1);
    const bar = bars()[0];
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    // 不二次换算：42 就是 42，不是 0.42、也不是 4200。
    expect(bar.getAttribute("aria-valuenow")).toBe("42");
    expect(accessibleName(bar)).toBe("下载中 42%");
    expect(bar.className).toContain("bg-muted");
    expect(bar.className).not.toContain("bg-primary/20");
  });
});

describe("SandboxSetupDialog（沙箱初始化条）", () => {
  const progress = (
    phase: SandboxSetupProgress["phase"],
    extra: Partial<SandboxSetupProgress> = {},
  ): SandboxSetupProgress => ({ phase, message: `phase:${phase}`, ...extra });

  beforeEach(() => {
    window.electronAPI = { platform: "linux" } as never;
    useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  });

  it("progress.progress 已是百分比：42/100，名称用固定的 sandbox.progressLabel", async () => {
    await renderAsync(
      <SandboxSetupDialog
        progress={progress("installing_deps", { progress: 42 })}
      />,
    );

    expect(bars()).toHaveLength(1);
    const bar = bars()[0];
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(bar.getAttribute("aria-valuenow")).toBe("42");
    expect(accessibleName(bar)).toBe("进度");
    expect(bar.className).toContain("bg-muted");
    expect(fillOf(bar)).toContain("translateX(-58%)");
  });

  it("完成态：success 走 Indicator 子选择器，Indicator 仍是 Root 的直接子节点", async () => {
    await renderAsync(
      <SandboxSetupDialog progress={progress("ready", { progress: 100 })} />,
    );

    const bar = bars()[0];
    expect(bar.getAttribute("aria-valuenow")).toBe("100");
    expect(bar.className).toContain("[&>div]:bg-success");
    // 只给 Root 加 bg-success 会改错轨道，所以必须落在直接子节点上。
    const indicator = bar.firstElementChild;
    expect(indicator?.tagName).toBe("DIV");
    expect(indicator).toBe(bar.querySelector("div"));
  });
});

describe("StatusPopover（上下文条与额度窗口条）", () => {
  const quota = {
    providerId: "openai-codex",
    providerName: "OpenAI Codex",
    planName: "team",
    windows: [
      { kind: "session" as const, usedPercent: 42 },
      { kind: "weekly" as const, usedPercent: 50 },
    ],
  };

  async function openPanel(contextUsagePercentage: number) {
    vi.stubGlobal("electronAPI", {
      quota: { list: vi.fn(async () => [quota]) },
    });
    await renderAsync(
      <StatusPopover
        contextUsagePercentage={contextUsagePercentage}
        contextRingColorClass="text-primary"
        contextStatusDetails={{
          usedLabel: "87.2K",
          totalLabel: "258K",
          cacheHitRate: "--",
        }}
      />,
    );
    act(() => container.querySelector("button")!.click());
    await act(async () => {});
  }

  it("三条各自有名称，百分比原样落成 n/100", async () => {
    await openPanel(42);

    expect(bars()).toHaveLength(3);

    const context = barNamed("上下文");
    expect(context.getAttribute("aria-valuemin")).toBe("0");
    expect(context.getAttribute("aria-valuemax")).toBe("100");
    expect(context.getAttribute("aria-valuenow")).toBe("42");
    expect(context.className).toContain("bg-accent");
    expect(context.className).toContain("flex-1");
    expect(fillOf(context)).toContain("translateX(-58%)");

    const session = barNamed("5h 窗口");
    expect(session.getAttribute("aria-valuemax")).toBe("100");
    expect(session.getAttribute("aria-valuenow")).toBe("42");

    const weekly = barNamed("7d 窗口");
    expect(weekly.getAttribute("aria-valuemax")).toBe("100");
    expect(weekly.getAttribute("aria-valuenow")).toBe("50");
    expect(fillOf(weekly)).toContain("translateX(-50%)");
  });
});
