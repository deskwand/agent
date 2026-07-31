// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelInstanceCatalog } from "../../renderer/components/remote/ChannelInstanceCatalog";
import type { ChannelPairingEvent, ChannelInstanceStatus } from "../../shared/ipc-types";
import type { ServerEvent } from "../../renderer/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// QR generation is async; return the input unchanged so tests can assert
// on the pairing imageUrl value directly.
vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn(async (value: string) => value),
  },
}));

const QR_DATA_URL = "data:image/png;base64,AA==";
let root: Root;
let container: HTMLDivElement;
let serverHandler: ((event: ServerEvent) => void) | undefined;
let unsubscribe: ReturnType<typeof vi.fn>;

function pairing(
  state: ChannelPairingEvent["state"],
  overrides: Partial<ChannelPairingEvent> = {},
): ChannelPairingEvent {
  return {
    version: 1,
    channelType: "wechat",
    channelInstanceId: "wechat-1",
    generation: 1,
    state,
    imageUrl:
      state === "pending" || state === "scanned" ? QR_DATA_URL : undefined,
    timestamp: 1,
    ...overrides,
  };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  unsubscribe = vi.fn(() => {
    serverHandler = undefined;
  });
  window.electronAPI = {
    on: vi.fn((handler: (event: ServerEvent) => void) => {
      serverHandler = handler;
      return unsubscribe;
    }),
    remote: {
      listChannels: vi.fn(async () => [
        {
          id: "wechat-1",
          name: "Personal WeChat",
          type: "wechat",
          enabled: true,
          config: {},
        },
      ]),
      getChannelPairings: vi.fn(async () => [pairing("pending")]),
      getChannelStatus: vi.fn(async () => [
        {
          id: "wechat-1",
          name: "Personal WeChat",
          type: "wechat" as const,
          enabled: true,
          connected: false,
          state: "starting" as const,
        },
      ]),
      updateChannel: vi.fn(async () => ({})),
      deleteChannel: vi.fn(async () => true),
      createChannel: vi.fn(async () => ({})),
    },
  } as unknown as typeof window.electronAPI;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderCatalog(): Promise<void> {
  await act(async () => {
    root.render(React.createElement(ChannelInstanceCatalog));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("ChannelInstanceCatalog pairing rendering", () => {
  it("renders and clears the QR in the matching WeChat card", async () => {
    await renderCatalog();
    expect(
      container.querySelector(`img[src="${QR_DATA_URL}"]`),
    ).not.toBeNull();
    expect(container.textContent).toContain("remote.wechatScanTitle");
    await act(async () => {
      serverHandler?.({
        type: "remote.channelPairing",
        payload: pairing("confirmed"),
      });
    });
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows terminal pairing text without retaining the QR", async () => {
    await renderCatalog();
    await act(async () => {
      serverHandler?.({
        type: "remote.channelPairing",
        payload: pairing("failed"),
      });
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("remote.wechatPairingState.failed");
  });

  it("shows QR only in the matching WeChat instance", async () => {
    window.electronAPI!.remote.listChannels = vi.fn(async () => [
      {
        id: "wechat-1",
        name: "Personal WeChat",
        type: "wechat" as const,
        enabled: true,
        config: {},
      },
      {
        id: "wechat-2",
        name: "Work WeChat",
        type: "wechat" as const,
        enabled: true,
        config: {},
      },
    ]);
    window.electronAPI!.remote.getChannelPairings = vi.fn(async () => [
      pairing("pending"),
    ]);
    window.electronAPI!.remote.getChannelStatus = vi.fn(async () =>
      [
        { id: "wechat-1", name: "Personal WeChat", type: "wechat", enabled: true, connected: false, state: "starting" },
        { id: "wechat-2", name: "Work WeChat", type: "wechat", enabled: true, connected: false, state: "stopped" },
      ] satisfies ChannelInstanceStatus[],
    ) as unknown as typeof window.electronAPI.remote.getChannelStatus;
    await renderCatalog();
    const wechat1 = container.querySelector(
      '[data-channel-instance-id="wechat-1"]',
    );
    const wechat2 = container.querySelector(
      '[data-channel-instance-id="wechat-2"]',
    );
    expect(wechat1?.querySelector("img")).not.toBeNull();
    expect(wechat2?.querySelector("img")).toBeNull();
  });

  it("ignores older generation snapshot when a live event is newer", async () => {
    let resolveSnapshot!: (value: ChannelPairingEvent[]) => void;
    const deferred = new Promise<ChannelPairingEvent[]>((resolve) => {
      resolveSnapshot = resolve;
    });
    window.electronAPI!.remote.getChannelPairings = vi.fn(() => deferred);
    await act(async () => {
      root.render(React.createElement(ChannelInstanceCatalog));
      await Promise.resolve();
    });
    expect(serverHandler).toBeDefined();

    const newerQr = "data:image/png;base64,AQ==";
    await act(async () => {
      serverHandler?.({
        type: "remote.channelPairing",
        payload: pairing("scanned", {
          generation: 2,
          timestamp: 100,
          imageUrl: newerQr,
        }),
      });
      resolveSnapshot([pairing("pending")]);
      await Promise.resolve();
    });

    expect(container.querySelector(`img[src="${newerQr}"]`)).not.toBeNull();
    expect(container.querySelector(`img[src="${QR_DATA_URL}"]`)).toBeNull();
    expect(container.textContent).toContain("remote.wechatPairingState.scanned");
  });

  it("does not restore QR from a stale snapshot after confirmation", async () => {
    let resolveSnapshot!: (value: ChannelPairingEvent[]) => void;
    window.electronAPI!.remote.getChannelPairings = vi.fn(
      () => new Promise<ChannelPairingEvent[]>((resolve) => {
        resolveSnapshot = resolve;
      }),
    );
    await act(async () => {
      root.render(React.createElement(ChannelInstanceCatalog));
      await Promise.resolve();
    });

    await act(async () => {
      serverHandler?.({
        type: "remote.channelPairing",
        payload: pairing("confirmed", { generation: 2, timestamp: 100 }),
      });
      resolveSnapshot([pairing("pending")]);
      await Promise.resolve();
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).not.toContain("remote.wechatScanTitle");
  });

  it("ignores an older equal-generation state", async () => {
    await renderCatalog();
    const scannedQr = "data:image/png;base64,Ag==";
    await act(async () => {
      serverHandler?.({
        type: "remote.channelPairing",
        payload: pairing("scanned", { timestamp: 2, imageUrl: scannedQr }),
      });
      serverHandler?.({
        type: "remote.channelPairing",
        payload: pairing("pending", { timestamp: 1 }),
      });
    });
    expect(container.querySelector(`img[src="${scannedQr}"]`)).not.toBeNull();
    expect(container.textContent).toContain("remote.wechatPairingState.scanned");
  });

  it("keeps terminal text for expired without QR", async () => {
    window.electronAPI!.remote.getChannelPairings = vi.fn(async () => [
      pairing("expired"),
    ]);
    await renderCatalog();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain(
      "remote.wechatPairingState.expired",
    );
  });

  it("clears terminal expired when a newer pending event arrives", async () => {
    window.electronAPI!.remote.getChannelPairings = vi.fn(async () => [
      pairing("expired"),
    ]);
    await renderCatalog();
    expect(container.textContent).toContain(
      "remote.wechatPairingState.expired",
    );

    await act(async () => {
      serverHandler?.({
        type: "remote.channelPairing",
        payload: {
          ...pairing("pending"),
          generation: 2,
          timestamp: 100,
        },
      });
    });

    expect(
      container.querySelector(`img[src="${QR_DATA_URL}"]`),
    ).not.toBeNull();
    expect(container.textContent).not.toContain(
      "remote.wechatPairingState.expired",
    );
  });

  it("keeps live subscription when snapshot loading fails", async () => {
    window.electronAPI!.remote.getChannelPairings = vi.fn(async () => {
      throw new Error("snapshot unavailable");
    });
    await renderCatalog();
    expect(serverHandler).toBeDefined();
    expect(container.textContent).toContain("channelNames.wechat");
  });

  it("unsubscribes from pairing events on unmount", async () => {
    await renderCatalog();
    await act(async () => root.unmount());
    expect(unsubscribe).toHaveBeenCalledOnce();
    root = createRoot(container);
  });

  it("preserves create/delete behavior after pairing section is added", async () => {
    await renderCatalog();
    // The channel grid and delete button should still exist
    expect(
      container.querySelector('[data-channel-add="wechat"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        'button[aria-label="remote.deleteChannel"]',
      ),
    ).not.toBeNull();
  });
});
