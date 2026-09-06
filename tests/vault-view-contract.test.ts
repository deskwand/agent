// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VaultView } from "../src/renderer/components/VaultView";
import { useAppStore } from "../src/renderer/store";
import type { VaultSnapshot } from "../src/shared/vault";

vi.mock("react-i18next", () => {
  const translations: Record<string, string> = {
    "vault.title": "Vault",
    "vault.upload": "Upload",
    "vault.sync": "Sync",
    "vault.filter.all": "All",
    "vault.filter.documents": "Documents",
    "vault.filter.skills": "Skills",
    "vault.filter.sessions": "Sessions",
    "vault.filter.other": "Other",
    "vault.status.pending": "Pending Backup",
    "vault.status.failed": "Sync Failed",
    "vault.action.open": "Open",
    "vault.action.reveal": "Reveal in Folder",
    "vault.action.export": "Export",
    "vault.action.delete": "Delete",
    "vault.recoveryCode": "Recovery code",
    "vault.setup.open": "Set up encrypted cloud backup",
    "vault.syncing": "Syncing…",
    "vault.syncComplete": "Sync complete",
    "vault.alreadyLatest": "Already up to date",
    "vault.dismiss": "Dismiss",
    "vault.error.loginRequired": "Sign in to sync your Vault",
    "vault.error.syncFailed": "Cloud sync failed; your local files are safe",
  };
  const translate = (key: string) => translations[key] ?? key;
  return {
    useTranslation: () => ({
      t: translate,
      i18n: { language: "en" },
    }),
  };
});

describe("VaultView", () => {
  let container: HTMLDivElement;
  let root: Root;
  const api = {
    getSnapshot: vi.fn(async () => ({
      items: [
        {
          name: "readme.md",
          ext: "md",
          size: 5,
          mtime: 1,
          syncStatus: "pending" as const,
        },
      ],
      pendingCount: 1,
      hasLocalIndex: true,
    })),
    importFile: vi.fn(async () => ({
      items: [],
      pendingCount: 0,
      hasLocalIndex: true,
    })),
    openFile: vi.fn(async () => ({ error: null })),
    revealFile: vi.fn(async () => true),
    exportFile: vi.fn(async () => ({ canceled: false })),
    deleteFile: vi.fn(async () => ({
      items: [],
      pendingCount: 0,
      hasLocalIndex: true,
    })),
    sync: vi.fn(async () => ({
      items: [],
      pendingCount: 0,
      hasLocalIndex: true,
    })),
    checkRemoteBackup: vi.fn(async () => false),
    generateRecoveryCode: vi.fn(
      async () => "123456789ABCDEFGHJKLMNPQRSTUVWXYZ",
    ),
    initialize: vi.fn(async () => undefined),
    restore: vi.fn(async () => ({ restored: 0, renamed: 0 })),
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { vault: api },
    });
    useAppStore.setState({
      cloudConfig: {
        serverUrl: "https://api.deskwand.com",
        token: "token",
        isLoggedIn: true,
        email: "user@example.com",
        level: "free",
        creditsBalance: 0,
        modes: [],
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
    vi.useRealTimers();
    useAppStore.setState({ cloudConfig: null });
  });

  it("renders the local snapshot without requiring cloud access", async () => {
    await act(async () => {
      root.render(createElement(VaultView));
    });

    expect(api.getSnapshot).toHaveBeenCalledTimes(1);
    expect(api.checkRemoteBackup).not.toHaveBeenCalled();
    expect(container.textContent).toContain("readme.md");
    expect(container.textContent).toContain("Pending Backup");
  });

  it("does not offer a new recovery code after initialization", async () => {
    api.getSnapshot.mockResolvedValueOnce({
      items: [],
      pendingCount: 0,
      hasLocalIndex: true,
      isInitialized: true,
    });

    await act(async () => {
      root.render(createElement(VaultView));
      await Promise.resolve();
    });

    expect(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Set up encrypted cloud backup",
      ),
    ).toBeUndefined();
  });

  it("reuses the recovery code while setup is open", async () => {
    await act(async () => {
      root.render(createElement(VaultView));
    });
    const setup = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Set up encrypted cloud backup",
    );

    await act(async () => {
      setup?.click();
      await Promise.resolve();
    });
    await act(async () => {
      setup?.click();
      await Promise.resolve();
    });

    expect(api.generateRecoveryCode).toHaveBeenCalledTimes(1);
  });

  it("accepts a saved recovery code for a remote restore", async () => {
    useAppStore.setState({
      cloudConfig: {
        serverUrl: "https://api.deskwand.com",
        token: "token",
        isLoggedIn: true,
        email: "user@example.com",
        level: "free",
        creditsBalance: 0,
        modes: [],
      },
    });
    api.getSnapshot.mockResolvedValueOnce({
      items: [],
      pendingCount: 0,
      hasLocalIndex: false,
    });
    api.checkRemoteBackup.mockResolvedValueOnce(true);

    await act(async () => {
      root.render(createElement(VaultView));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('input[aria-label="Recovery code"]'),
    ).not.toBeNull();
    useAppStore.setState({ cloudConfig: null });
  });

  it("shows syncing feedback and disables the sync button immediately", async () => {
    let resolveSync!: (snapshot: VaultSnapshot) => void;
    api.sync.mockImplementationOnce(
      () =>
        new Promise<VaultSnapshot>((resolve) => {
          resolveSync = resolve;
        }),
    );

    await act(async () => {
      root.render(createElement(VaultView));
    });
    const sync = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Sync",
    );

    await act(async () => {
      sync?.click();
    });

    expect(container.textContent).toContain("Syncing…");
    expect(sync?.disabled).toBe(true);

    await act(async () => {
      resolveSync({
        items: [],
        pendingCount: 0,
        hasLocalIndex: true,
      });
    });
  });

  it("shows sync completion and dismisses it after three seconds", async () => {
    vi.useFakeTimers();
    api.sync.mockResolvedValueOnce({
      items: [],
      pendingCount: 0,
      hasLocalIndex: true,
    });

    await act(async () => {
      root.render(createElement(VaultView));
    });
    const sync = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Sync",
    );
    await act(async () => {
      sync?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Sync complete");
    await act(async () => {
      vi.advanceTimersByTime(2999);
    });
    expect(container.textContent).toContain("Sync complete");
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(container.textContent).not.toContain("Sync complete");
  });

  it("keeps a sync failure visible until dismissed", async () => {
    api.sync.mockRejectedValueOnce(new Error("NETWORK_DOWN"));

    await act(async () => {
      root.render(createElement(VaultView));
    });
    const sync = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Sync",
    );
    await act(async () => {
      sync?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Cloud sync failed");
    const dismiss = container.querySelector('button[aria-label="Dismiss"]');
    expect(dismiss).not.toBeNull();
    await act(async () => {
      dismiss?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).not.toContain("Cloud sync failed");
  });

  it("does not call sync when the user is logged out", async () => {
    useAppStore.setState({ cloudConfig: null });

    await act(async () => {
      root.render(createElement(VaultView));
    });
    const sync = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Sync",
    );
    await act(async () => {
      sync?.click();
    });

    expect(api.sync).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Sign in to sync your Vault");
    useAppStore.setState({ cloudConfig: null });
  });

  it("shows already latest when no files were pending", async () => {
    api.getSnapshot.mockResolvedValueOnce({
      items: [],
      pendingCount: 0,
      hasLocalIndex: true,
    });
    api.sync.mockResolvedValueOnce({
      items: [],
      pendingCount: 0,
      hasLocalIndex: true,
    });

    await act(async () => {
      root.render(createElement(VaultView));
      await Promise.resolve();
    });
    const sync = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Sync",
    );
    await act(async () => {
      sync?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Already up to date");
  });

  it("keeps the logged-out error after a previous success timer", async () => {
    vi.useFakeTimers();
    api.sync.mockResolvedValueOnce({
      items: [],
      pendingCount: 0,
      hasLocalIndex: true,
    });

    await act(async () => {
      root.render(createElement(VaultView));
    });
    const sync = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Sync",
    );
    await act(async () => {
      sync?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Sync complete");

    await act(async () => {
      useAppStore.setState({ cloudConfig: null });
    });
    const loggedOutSync = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Sync",
    );
    await act(async () => {
      loggedOutSync?.click();
    });
    expect(container.textContent).toContain("Sign in to sync your Vault");

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(container.textContent).toContain("Sign in to sync your Vault");
  });

  it("treats a resolved snapshot with pending files as a sync failure", async () => {
    api.sync.mockResolvedValueOnce({
      items: [],
      pendingCount: 1,
      hasLocalIndex: true,
    });

    await act(async () => {
      root.render(createElement(VaultView));
    });
    const sync = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Sync",
    );
    await act(async () => {
      sync?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Cloud sync failed");
  });

  it("uploads through high-level IPC without receiving file bytes", async () => {
    await act(async () => {
      root.render(createElement(VaultView));
    });
    const upload = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Upload",
    );

    await act(async () => {
      upload?.click();
    });

    expect(api.importFile).toHaveBeenCalledTimes(1);
    expect(api.importFile.mock.calls[0]).toHaveLength(0);
  });
});
