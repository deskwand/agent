// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectorEntry } from "../../shared/connectors";

const api = vi.hoisted(() => {
  const connectors = { list: vi.fn(), setEnabled: vi.fn() };
  const capabilities = {
    permissions: vi.fn(),
    openPermissionSettings: vi.fn(),
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    connectors,
    capabilities,
  };
  return { connectors, capabilities };
});

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { SettingsCapabilities } from "../../renderer/components/settings/SettingsCapabilities";

const COMPUTER_USE: ConnectorEntry = {
  key: "mcp:builtin:GUI_Operate",
  serverName: "GUI_Operate",
  source: "mcp-builtin",
  transport: "stdio",
  nameKey: "connectors.builtin.computerUse",
  descriptionKey: "connectors.builtin.computerUseDesc",
  instances: [
    {
      id: "GUI_Operate",
      label: "GUI_Operate",
      status: { kind: "off" },
      summary: "connectors.summary.local",
    },
  ],
};

let container: HTMLDivElement;
let root: Root;

async function mount(): Promise<void> {
  await act(async () => {
    root.render(<SettingsCapabilities />);
  });
}

function toggle(): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>(
    '[data-testid="capability-toggle"]',
  )!;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
  api.connectors.list.mockResolvedValue([COMPUTER_USE]);
  api.connectors.setEnabled.mockResolvedValue({ ok: true });
  api.capabilities.permissions.mockResolvedValue({
    required: true,
    accessibility: false,
    screenRecording: true,
    microphone: true,
  });
  api.capabilities.openPermissionSettings.mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("SettingsCapabilities", () => {
  it("renders the capability with its switch off", async () => {
    await mount();
    expect(container.textContent).toContain("connectors.builtin.computerUse");
    expect(toggle().getAttribute("aria-checked")).toBe("false");
  });

  it("renders the capability description too", async () => {
    await mount();
    expect(container.textContent).toContain(
      "connectors.builtin.computerUseDesc",
    );
  });

  it("turns the capability on through the connectors ipc", async () => {
    await mount();
    await act(async () => {
      toggle().click();
    });
    expect(api.connectors.setEnabled).toHaveBeenCalledWith("GUI_Operate", true);
  });

  it("says an enable takes effect in the next chat when there is no live session", async () => {
    api.connectors.setEnabled.mockResolvedValue({
      ok: true,
      pendingActivation: true,
    });
    await mount();
    await act(async () => {
      toggle().click();
    });
    expect(container.textContent).toContain(
      "settings.capabilities.pendingActivation",
    );
  });

  it("says the same when disabling — the tools are still there for a live session", async () => {
    api.connectors.list.mockResolvedValue([
      {
        ...COMPUTER_USE,
        instances: [
          { ...COMPUTER_USE.instances[0], status: { kind: "ready" } },
        ],
      },
    ]);
    api.connectors.setEnabled.mockResolvedValue({
      ok: true,
      pendingActivation: true,
    });
    await mount();
    await act(async () => {
      toggle().click();
    });
    expect(api.connectors.setEnabled).toHaveBeenCalledWith(
      "GUI_Operate",
      false,
    );
    expect(container.textContent).toContain(
      "settings.capabilities.pendingActivation",
    );
  });

  it("shows no notice when the toggle does not need a later session", async () => {
    // 这条盯的是「把上一次的提示清掉」：否则上一次的「下次对话生效」会一直挂着。
    api.connectors.setEnabled.mockResolvedValue({
      ok: true,
      pendingActivation: true,
    });
    await mount();
    await act(async () => {
      toggle().click();
    });
    expect(container.textContent).toContain(
      "settings.capabilities.pendingActivation",
    );

    api.connectors.setEnabled.mockResolvedValue({ ok: true });
    await act(async () => {
      toggle().click();
    });
    expect(container.textContent).not.toContain(
      "settings.capabilities.pendingActivation",
    );
  });

  it("shows only the missing permission row", async () => {
    await mount();
    const rows = [
      ...container.querySelectorAll('[data-testid="permission-row"]'),
    ];
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain(
      "settings.capabilities.permission.accessibility",
    );
    expect(rows[0].textContent).not.toContain(
      "settings.capabilities.permission.screen-recording",
    );
  });

  it("tells the user a screen-recording grant needs a restart", async () => {
    api.capabilities.permissions.mockResolvedValue({
      required: true,
      accessibility: true,
      screenRecording: false,
      microphone: true,
    });
    await mount();
    expect(container.textContent).toContain(
      "settings.capabilities.permission.screenRecordingRestart",
    );
  });

  it("hides the permission block when nothing is required", async () => {
    api.capabilities.permissions.mockResolvedValue({
      required: false,
      accessibility: false,
      screenRecording: false,
      microphone: true,
    });
    await mount();
    expect(
      container.querySelector('[data-testid="permission-row"]'),
    ).toBeNull();
  });

  it("hides the whole permission block when everything is granted", async () => {
    api.capabilities.permissions.mockResolvedValue({
      required: true,
      accessibility: true,
      screenRecording: true,
      microphone: true,
    });
    await mount();
    expect(
      container.querySelector('[data-testid="permission-row"]'),
    ).toBeNull();
  });

  it("opens the matching system-settings pane", async () => {
    await mount();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="permission-open"]')!
        .click();
    });
    expect(api.capabilities.openPermissionSettings).toHaveBeenCalledWith(
      "accessibility",
    );
  });

  it("opens the screen-recording pane from its own row", async () => {
    api.capabilities.permissions.mockResolvedValue({
      required: true,
      accessibility: true,
      screenRecording: false,
      microphone: true,
    });
    await mount();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="permission-open"]')!
        .click();
    });
    expect(api.capabilities.openPermissionSettings).toHaveBeenCalledWith(
      "screen-recording",
    );
  });

  it("reports a missing microphone by its own field, not by position", async () => {
    // 回归测试：设置页重构后，这个判断曾退化成三元链
    // （`kind === "accessibility" ? !a : !screenRecording`），于是
    // 屏幕录制已授予、麦克风未授予时，麦克风那一行**根本不会出现**。
    api.capabilities.permissions.mockResolvedValue({
      required: true,
      accessibility: true,
      screenRecording: true,
      microphone: false,
    });
    await mount();

    const rows = container.querySelectorAll('[data-testid="permission-row"]');
    expect(rows.length).toBe(1);
    expect(container.textContent).toContain(
      "settings.capabilities.permission.microphone",
    );
    expect(container.textContent).toContain(
      "settings.capabilities.permission.microphoneHint",
    );
  });

  it("opens the microphone pane from its own row", async () => {
    api.capabilities.permissions.mockResolvedValue({
      required: true,
      accessibility: true,
      screenRecording: true,
      microphone: false,
    });
    await mount();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="permission-open"]')!
        .click();
    });
    expect(api.capabilities.openPermissionSettings).toHaveBeenCalledWith(
      "microphone",
    );
  });

  it("re-checks permissions when the window regains focus", async () => {
    await mount();
    api.capabilities.permissions.mockClear();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(api.capabilities.permissions).toHaveBeenCalledTimes(1);
  });

  it("does not listen for focus while the tab is not active", async () => {
    await act(async () => {
      root.render(<SettingsCapabilities isActive={false} />);
    });
    api.capabilities.permissions.mockClear();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(api.capabilities.permissions).not.toHaveBeenCalled();
  });

  it("shows a load error when the capability list fails, and keeps the page", async () => {
    api.connectors.list.mockRejectedValue(new Error("boom"));
    await mount();
    expect(container.textContent).toContain("settings.capabilities.loadFailed");
    expect(
      container.querySelector('[data-testid="capability-card"]'),
    ).toBeNull();
  });

  it("keeps the capability card when only the permission query fails", async () => {
    // 一个 catch 包两个 Promise 就会把唯一的开关一起抹掉 —— 这条盯住那个回归。
    api.capabilities.permissions.mockRejectedValue(new Error("boom"));
    await mount();
    expect(
      container.querySelector('[data-testid="capability-card"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="permission-row"]'),
    ).toBeNull();
  });

  it("reports a failed toggle instead of silently flipping back", async () => {
    api.connectors.setEnabled.mockResolvedValue({
      ok: false,
      error: "disk is read-only",
    });
    await mount();
    await act(async () => {
      toggle().click();
    });
    expect(container.textContent).toContain("disk is read-only");
  });

  it("re-checks permissions when the tab becomes active again", async () => {
    root.render(<SettingsCapabilities isActive={false} />);
    await act(async () => {});
    api.capabilities.permissions.mockClear();
    await act(async () => {
      root.render(<SettingsCapabilities isActive={true} />);
    });
    expect(api.capabilities.permissions).toHaveBeenCalledTimes(1);
  });
});

describe("能力页：一卡一能力与权限归属", () => {
  it("不再渲染页面级段落与分组标题", async () => {
    await mount();
    expect(container.textContent).not.toContain("settings.capabilitiesIntro");
    expect(container.textContent).not.toContain(
      "settings.capabilities.localFeatures",
    );
  });

  it("Computer Use 的权限行与它同一张卡", async () => {
    await mount();
    const card = container.querySelector<HTMLElement>(
      '[data-testid="capability-card"]',
    )!;
    const perm = container.querySelector<HTMLElement>(
      '[data-testid="permission-row"]',
    )!;
    expect(card.closest(".rounded-container")).toBe(
      perm.closest(".rounded-container"),
    );
  });

  it("麦克风的权限行挂在语音输入那张卡里", async () => {
    api.capabilities.permissions.mockResolvedValue({
      required: true,
      accessibility: true,
      screenRecording: true,
      microphone: false,
    });
    await mount();
    const voiceRow = container.querySelector<HTMLElement>(
      '[data-testid="capability-voice"]',
    )!;
    const perm = container.querySelector<HTMLElement>(
      '[data-testid="permission-row"]',
    )!;
    expect(voiceRow.closest(".rounded-container")).toBe(
      perm.closest(".rounded-container"),
    );
  });

  it("Computer Use 的说明带上「随会话加载」", async () => {
    await mount();
    expect(container.textContent).toContain(
      "settings.capabilities.sessionToolNote",
    );
  });

  it("内置条目读不到时，权限提示仍有自己的卡", async () => {
    api.connectors.list.mockResolvedValue([]);
    await mount();
    expect(
      container.querySelector('[data-testid="capability-card"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="permission-row"]'),
    ).not.toBeNull();
  });

  it("第二个内置能力上线时，权限行仍跟着 Computer Use", async () => {
    const OTHER: ConnectorEntry = {
      ...COMPUTER_USE,
      key: "mcp:builtin:Other",
      serverName: "Other",
      nameKey: "connectors.builtin.other",
    };
    api.connectors.list.mockResolvedValue([COMPUTER_USE, OTHER]);
    await mount();

    const rows = [
      ...container.querySelectorAll<HTMLElement>(
        '[data-testid="capability-card"]',
      ),
    ];
    const perm = container.querySelector<HTMLElement>(
      '[data-testid="permission-row"]',
    )!;

    expect(rows).toHaveLength(2);
    // 权限行夹在 Computer Use 与后一个能力之间，而不是掉到卡尾（那会读成别人的权限）。
    expect(
      rows[0].compareDocumentPosition(perm) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      perm.compareDocumentPosition(rows[1]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
