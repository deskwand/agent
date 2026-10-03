// @vitest-environment jsdom
/**
 * 设置面板外壳的 DOM 级断言。
 *
 * 与 `tests/settings-panel-shell.test.ts` 分工不同：那边是源码级 grep，盯「某个字符串
 * 还在不在」；这边真渲染一次，盯「用户能不能看到、点得到」—— 比如某个 tab 因为分组
 * 漏了而整格消失，grep 是抓不到的。
 *
 * 其余子页全部降为桩：这条只关心外壳。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../renderer/components/settings/SettingsAPI", () => ({
  SettingsAPI: () => null,
}));
vi.mock("../../renderer/components/settings/SubagentSettings", () => ({
  SubagentSettings: () => null,
}));
vi.mock("../../renderer/components/settings/SettingsPersonalization", () => ({
  SettingsPersonalization: () => null,
}));
vi.mock("../../renderer/components/RemoteControlPanel", () => ({
  RemoteControlPanel: () => null,
}));
vi.mock("../../renderer/components/settings/SettingsLogs", () => ({
  SettingsLogs: () => null,
}));
vi.mock("../../renderer/components/settings/SettingsGeneral", () => ({
  SettingsGeneral: () => null,
}));
vi.mock("../../renderer/components/settings/SettingsArchived", () => ({
  SettingsArchived: () => null,
}));
vi.mock("../../renderer/components/settings/SettingsAbout", () => ({
  SettingsAbout: () => null,
}));
vi.mock("../../renderer/components/settings/SettingsCapabilities", () => ({
  SettingsCapabilities: () => null,
}));

import { SettingsPanel } from "../../renderer/components/SettingsPanel";

let container: HTMLDivElement;
let root: Root;

async function mount(): Promise<void> {
  await act(async () => {
    root.render(<SettingsPanel onClose={() => {}} />);
  });
}

function buttons(): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>("button")];
}

function buttonTexts(): string[] {
  return buttons().map((b) => b.textContent ?? "");
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("设置面板侧栏", () => {
  it("把 9 个 tab 全部渲染出来，一个不漏", async () => {
    await mount();
    const texts = buttonTexts();
    for (const key of [
      "settings.general",
      "settings.capabilitiesTitle",
      "settings.apiSettings",
      "subagent.title",
      "settings.personalization",
      "settings.remote",
      "settings.logs",
      "settings.archivedSessions",
      "settings.about",
    ]) {
      expect(
        texts.some((t) => t.includes(key)),
        `侧栏缺少 ${key}`,
      ).toBe(true);
    }
  });

  it("四个分组标题都在侧栏里", async () => {
    await mount();
    const texts = buttonTexts();
    expect(container.textContent).toContain("settings.groupGeneral");
    expect(container.textContent).toContain("settings.groupPersonal");
    expect(container.textContent).toContain("settings.groupIntegrations");
    expect(container.textContent).toContain("settings.groupOther");
    // 分组名不是可点的条目：它们不该出现在按钮文本里。
    expect(texts.some((t) => t.includes("settings.groupGeneral"))).toBe(false);
  });

  it("侧栏条目不显示描述，当前 tab 的描述只在右栏标题下", async () => {
    await mount();
    const texts = buttonTexts().join(" ");
    expect(texts).not.toContain("settings.generalDesc");
    expect(container.textContent).toContain("settings.generalDesc");
  });
  it("点另一个 tab 会把它标成当前页", async () => {
    await mount();
    const target = buttons().find((b) =>
      (b.textContent ?? "").includes("settings.logs"),
    )!;
    expect(target.getAttribute("aria-current")).toBeNull();
    await act(async () => {
      target.click();
    });
    const after = buttons().find((b) =>
      (b.textContent ?? "").includes("settings.logs"),
    )!;
    expect(after.getAttribute("aria-current")).toBe("page");
  });

  it("折叠成图标栏时隐藏分组标题，每个条目仍有无障碍名", async () => {
    vi.stubGlobal("innerWidth", 700);
    await mount();

    // 分组标题只在宽版渲染。
    expect(container.textContent).not.toContain("settings.groupGeneral");
    // 窄栏只剩图标，名字必须来自 aria-label（title 不是无障碍名）。
    const rail = buttons().filter((b) => b.getAttribute("aria-label"));
    expect(rail).toHaveLength(9);
    expect(rail.every((b) => (b.textContent ?? "") === "")).toBe(true);
  });
});
