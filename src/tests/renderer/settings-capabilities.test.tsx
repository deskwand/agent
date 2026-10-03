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
  });
  api.capabilities.openPermissionSettings.mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("SettingsCapabilities", () => {
  it("renders the capability and its off state", async () => {
    await mount();
    expect(container.textContent).toContain("connectors.builtin.computerUse");
    expect(container.textContent).toContain("settings.capabilities.statusOff");
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
    ].map((r) => r.getAttribute("data-permission"));
    expect(rows).toEqual(["accessibility"]);
  });

  it("tells the user a screen-recording grant needs a restart", async () => {
    api.capabilities.permissions.mockResolvedValue({
      required: true,
      accessibility: true,
      screenRecording: false,
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
    });
    await mount();
    // 只断言「没有 row」是不够的：容器与「重新检查」也必须一起消失。
    expect(container.textContent).not.toContain(
      "settings.capabilities.permission.title",
    );
    expect(
      container.querySelector('[data-testid="permission-row"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="permission-recheck"]'),
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

  it("re-checks permissions on demand", async () => {
    await mount();
    api.capabilities.permissions.mockClear();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="permission-recheck"]')!
        .click();
    });
    expect(api.capabilities.permissions).toHaveBeenCalledTimes(1);
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
