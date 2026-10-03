// @vitest-environment jsdom
/**
 * 接线测试：设置面板里「能力」这一格**真的挂上了**。
 *
 * 与 `settings-capabilities.test.tsx` 分工不同 —— 那边测组件本身的行为，
 * 这边只盯注册四处（TabId 联合 / initialTab 联合 / VALID_TABS / tabs 数组 +
 * 渲染分支）。漏改任何一处，组件写得再好用户也进不去，而且不会有别的测试报错。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

// 设置面板的其余子页全部降为 null：这条测试只关心「能力」那一格。
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
// 被验的对象换成桩，这样「渲染了没有」一目了然。
vi.mock("../../renderer/components/settings/SettingsCapabilities", () => ({
  SettingsCapabilities: () => <div data-testid="capabilities-stub" />,
}));

import { SettingsPanel } from "../../renderer/components/SettingsPanel";

let container: HTMLDivElement;
let root: Root;

async function mount(tab: "capabilities" | "general"): Promise<void> {
  await act(async () => {
    root.render(<SettingsPanel onClose={() => {}} initialTab={tab} />);
  });
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

describe("设置面板的能力 tab 接线", () => {
  it("renders the capabilities page when that tab is opened", async () => {
    await mount("capabilities");
    expect(
      container.querySelector('[data-testid="capabilities-stub"]'),
    ).not.toBeNull();
  });

  it("has a sidebar entry for the tab", async () => {
    // 只传 initialTab 测不到「侧栏那一项还在不在」：删掉 tabs 数组里的条目，
    // 用户就永远点不进来，而前一条用例仍然全绿。
    await mount("general");
    const labels = [...container.querySelectorAll("button")].map(
      (b) => b.textContent ?? "",
    );
    expect(labels.some((l) => l.includes("settings.capabilitiesTitle"))).toBe(
      true,
    );
  });

  it("does not render it for other tabs", async () => {
    await mount("general");
    expect(
      container.querySelector('[data-testid="capabilities-stub"]'),
    ).toBeNull();
  });
});
