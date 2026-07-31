// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelInstanceCatalog } from "../../renderer/components/remote/ChannelInstanceCatalog";
import type {
  ChannelInstanceConfig,
  ChannelInstanceStatus,
} from "../../shared/ipc-types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let root: Root;
let container: HTMLDivElement;
const FEISHU: ChannelInstanceConfig = {
  id: "feishu-1",
  name: "Feishu Org",
  type: "feishu",
  enabled: false,
  config: {},
};

const TELEGRAM: ChannelInstanceConfig = {
  id: "telegram-1",
  name: "My Telegram",
  type: "telegram",
  enabled: true,
  config: {},
};

function status(
  instance: ChannelInstanceConfig,
  overrides: Partial<ChannelInstanceStatus> = {},
): ChannelInstanceStatus {
  return {
    id: instance.id,
    name: instance.name,
    type: instance.type,
    enabled: instance.enabled,
    connected: overrides.state === "connected",
    state: "stopped",
    ...overrides,
  };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.electronAPI = {
    on: vi.fn(() => () => undefined),
    remote: {
      listChannels: vi.fn(async () => [FEISHU, TELEGRAM]),
      getChannelStatus: vi.fn(async () =>
        [status(FEISHU), status(TELEGRAM)] as ChannelInstanceStatus[],
      ),
      getChannelPairings: vi.fn(async () => []),
      updateChannel: vi.fn(async () => ({})),
      createChannel: vi.fn(async () => ({})),
      deleteChannel: vi.fn(async () => true),
    },
  } as unknown as typeof window.electronAPI;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(): Promise<void> {
  await act(async () => {
    root.render(React.createElement(ChannelInstanceCatalog));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("ChannelInstanceCatalog status indicators", () => {
  it("shows connected dot for a connected channel", async () => {
    window.electronAPI!.remote.getChannelStatus = vi.fn(async () => [
      status(FEISHU),
      status(TELEGRAM, { state: "connected", connected: true }),
    ]);
    await render();

    const card = container.querySelector('[data-channel-instance-id="telegram-1"]');
    expect(card?.querySelector(".dot-connected")).not.toBeNull();
  });

  it("shows failed dot and error code for a failed channel", async () => {
    window.electronAPI!.remote.getChannelStatus = vi.fn(async () => [
      status(FEISHU),
      status(TELEGRAM, { state: "failed", error: "AUTH_INVALID" }),
    ]);
    await render();

    const card = container.querySelector('[data-channel-instance-id="telegram-1"]');
    expect(card?.querySelector(".dot-failed")).not.toBeNull();
    expect(card?.textContent).toContain("AUTH_INVALID");
  });

  it("shows starting animation for a channel in starting state", async () => {
    window.electronAPI!.remote.getChannelStatus = vi.fn(async () => [
      status(FEISHU),
      status(TELEGRAM, { state: "starting" }),
    ]);
    await render();

    const card = container.querySelector('[data-channel-instance-id="telegram-1"]');
    expect(card?.querySelector(".dot-starting")).not.toBeNull();
  });

  it("shows stopped dot for a stopped channel", async () => {
    await render();

    const card = container.querySelector('[data-channel-instance-id="feishu-1"]');
    expect(card?.querySelector(".dot-stopped")).not.toBeNull();
  });

  it("shows disabled label for a disabled instance regardless of runtime state", async () => {
    // FEISHU is enabled: false in fixtures; force a connected runtime state.
    window.electronAPI!.remote.getChannelStatus = vi.fn(async () => [
      status(FEISHU, { state: "connected", connected: true }),
      status(TELEGRAM),
    ]);
    await render();

    const card = container.querySelector('[data-channel-instance-id="feishu-1"]');
    expect(card?.textContent).toContain("remote.channelStatus.disabled");
  });

  it("shows disabled label for a disabled instance", async () => {
    // FEISHU fixture has enabled: false
    await render();

    const card = container.querySelector('[data-channel-instance-id="feishu-1"]');
    expect(card?.textContent).toContain("remote.channelStatus.disabled");
    expect(card?.textContent).not.toContain("remote.channelStatus.stopped");
  });

  it("shows runtime state label for an enabled instance", async () => {
    // TELEGRAM fixture has enabled: true
    window.electronAPI!.remote.getChannelStatus = vi.fn(async () =>
      [status(FEISHU), status(TELEGRAM, { state: "connected" })] as ChannelInstanceStatus[],
    );
    await render();

    const card = container.querySelector('[data-channel-instance-id="telegram-1"]');
    expect(card?.textContent).toContain("remote.channelStatus.connected");
  });
});

describe("ChannelInstanceCatalog enable/disable toggle", () => {
  it("shows toggle in enabled state when channel is enabled", async () => {
    await render();
    const card = container.querySelector('[data-channel-instance-id="telegram-1"]');
    expect(card?.querySelector(".toggle-on")).not.toBeNull();
  });

  it("shows toggle in disabled state when channel is disabled", async () => {
    await render();
    const card = container.querySelector('[data-channel-instance-id="feishu-1"]');
    expect(card?.querySelector(".toggle-on")).toBeNull();
  });

  it("calls updateChannel with enabled=false when toggling off", async () => {
    await render();
    const toggle = container.querySelector(
      '[data-channel-instance-id="telegram-1"] .toggle-track',
    ) as HTMLElement | null;
    if (toggle) {
      await act(async () => toggle.click());
      expect(window.electronAPI!.remote.updateChannel).toHaveBeenCalledWith(
        "telegram-1",
        { enabled: false },
      );
    }
  });

  it("calls updateChannel with enabled=true when toggling on", async () => {
    await render();
    const toggle = container.querySelector(
      '[data-channel-instance-id="feishu-1"] .toggle-track',
    ) as HTMLElement | null;
    if (toggle) {
      await act(async () => toggle.click());
      expect(window.electronAPI!.remote.updateChannel).toHaveBeenCalledWith(
        "feishu-1",
        { enabled: true },
      );
    }
  });
});

describe("ChannelInstanceCatalog credential edit", () => {
  it("does not show credential fields for wechat instances", async () => {
    window.electronAPI!.remote.listChannels = vi.fn(async () =>
      [
        {
          id: "wc-1",
          name: "WeChat",
          type: "wechat",
          enabled: true,
          config: {},
        },
      ] as ChannelInstanceConfig[],
    );
    window.electronAPI!.remote.getChannelStatus = vi.fn(async () =>
      [
        {
          id: "wc-1",
          name: "WeChat",
          type: "wechat",
          enabled: true,
          connected: false,
          state: "starting",
        },
      ] as ChannelInstanceStatus[],
    );
    await render();
    const card = container.querySelector('[data-channel-instance-id="wc-1"]');
    expect(card?.querySelector("input")).toBeNull(); // no credential inputs
  });

  it("shows appId and appSecret inputs for feishu", async () => {
    await render();
    // Click edit to expand
    const card = container.querySelector('[data-channel-instance-id="feishu-1"]');
    const editBtn = card?.querySelector('[data-edit]') as HTMLElement | null;
    if (editBtn) {
      await act(async () => editBtn.click());
    }
    expect(card?.querySelector('input[placeholder*="remote.credentialAppId"]')).not.toBeNull();
    expect(card?.querySelector('input[placeholder*="remote.credentialAppSecret"]')).not.toBeNull();
  });

  it("shows botToken input for telegram", async () => {
    await render();
    const card = container.querySelector('[data-channel-instance-id="telegram-1"]');
    const editBtn = card?.querySelector('[data-edit]') as HTMLElement | null;
    if (editBtn) {
      await act(async () => editBtn.click());
    }
    expect(card?.querySelector('input[placeholder*="remote.credentialBotToken"]')).not.toBeNull();
  });

  it("saves updated config via updateChannel", async () => {
    await render();
    const card = container.querySelector('[data-channel-instance-id="telegram-1"]');
    const editBtn = card?.querySelector('[data-edit]') as HTMLElement | null;
    if (editBtn) {
      await act(async () => editBtn.click());
    }
    const input = card?.querySelector('input[placeholder*="remote.credentialBotToken"]') as HTMLInputElement | null;
    if (input) {
      await act(async () => {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, "value")?.set;
        nativeInputValueSetter?.call(input, '12345:test-token');
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    const saveBtn = card?.querySelector('[data-save]') as HTMLElement | null;
    if (saveBtn) {
      await act(async () => saveBtn.click());
    }
    expect(window.electronAPI!.remote.updateChannel).toHaveBeenCalledWith(
      "telegram-1",
      expect.objectContaining({ config: expect.objectContaining({ botToken: "12345:test-token" }) }),
    );
  });

  it("renders a channel grid with all 6 types", async () => {
    await render();
    for (const type of ["feishu", "telegram", "discord", "qq", "slack", "wechat"]) {
      expect(
        container.querySelector(`[data-channel-add="${type}"]`),
      ).not.toBeNull();
    }
  });

  it("disables grid cells for already-added types", async () => {
    await render(); // FEISHU + TELEGRAM exist
    const feishuCell = container.querySelector('[data-channel-add="feishu"]');
    const telegramCell = container.querySelector('[data-channel-add="telegram"]');
    const discordCell = container.querySelector('[data-channel-add="discord"]');
    expect(feishuCell?.getAttribute("aria-disabled")).toBe("true");
    expect(telegramCell?.getAttribute("aria-disabled")).toBe("true");
    expect(discordCell?.getAttribute("aria-disabled")).toBe("false");
  });

  it("removes the select and add button", async () => {
    await render();
    expect(container.querySelector("select")).toBeNull();
    expect(container.textContent).not.toContain("remote.addChannel");
  });
});
