// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VaultCloudError } from "../src/main/vault/cloud-client";
import { VaultView } from "../src/renderer/components/VaultView";
import { useAppStore } from "../src/renderer/store";
import type { VaultSnapshot, VaultSnapshotItem } from "../src/shared/vault";

const TRANSLATIONS: Record<string, string> = {
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "vault.title": "Vault",
  "vault.subtitle": "Local files with encrypted cloud backup",
  "vault.upload": "Upload",
  "vault.sync": "Sync",
  "vault.syncing": "Syncing…",
  "vault.syncComplete": "Sync complete",
  "vault.alreadyLatest": "Already up to date",
  "vault.dismiss": "Dismiss",
  "vault.filter.files": "Files",
  "vault.filter.skills": "Skills",
  "vault.filter.sessions": "Sessions",
  "vault.status.synced": "Synced",
  "vault.status.pending": "Pending Backup",
  "vault.status.failed": "Sync Failed",
  "vault.action.open": "Open",
  "vault.action.reveal": "Reveal in Folder",
  "vault.action.export": "Export",
  "vault.action.delete": "Delete",
  "vault.action.more": "More actions for {{name}}",
  "vault.confirm.delete": "Delete {{name}} from your Vault?",
  "vault.confirm.deleteAction": "Delete",
  "vault.comingSoon": "Coming soon",
  "vault.fileCount_one": "{{count}} file",
  "vault.fileCount_other": "{{count}} files",
  "vault.empty": "No files in your Vault",
  "vault.loginHint": "Sign in to back up files to the cloud",
  "vault.recoveryCode": "Recovery code",
  "vault.pendingCount": "{{count}} pending",
  "vault.usage": "Used {{used}} / {{quota}}",
  "vault.setup.configured": "Encrypted cloud backup is set up",
  "vault.setup.open": "Set up encrypted cloud backup",
  "vault.setup.title": "Save your recovery code",
  "vault.setup.confirmSaved": "I saved this recovery code securely",
  "vault.setup.finish": "Finish setup",
  "vault.restore.prompt":
    "A cloud backup is available. Set your recovery code to restore it.",
  "vault.restore.action": "Restore",
  "vault.restore.restoring": "Restoring your cloud backup…",
  "vault.restore.remoteError": "Couldn't check your cloud backup status",
  "vault.restore.failed": "Restore failed. Try again.",
  "vault.restore.retry": "Retry",
  "vault.firstSetup.title": "Set your recovery code",
  "vault.firstSetup.body":
    "Create a recovery code and store it safely. It restores your cloud backup on other devices.",
  "vault.error.loginRequired": "Sign in to sync your Vault",
  "vault.error.setupRequired": "Set up encrypted cloud backup first",
  "vault.error.fileTooLarge": "Files must be 20 MB or smaller",
  "vault.error.localQuotaExceeded":
    "Your local Vault is full; delete files before importing another",
  "vault.error.localOperation": "The local Vault operation failed",
  "vault.error.syncFailed": "Cloud sync failed; your local files are safe",
  "vault.error.cloudQuotaExceeded":
    "Cloud backup storage is full; your local file was kept. Delete files or upgrade storage to retry",
  "vault.error.invalidRecoveryCode": "The recovery code is invalid",
  "vault.error.alreadyInitialized": "Encrypted backup is already set up",
  "vault.error.keychainUnavailable":
    "Secure key storage is unavailable on this device",
  "vault.error.recoveryMismatch":
    "The recovery code does not match this backup",
  "vault.error.noRemoteBackup": "No cloud backup is available",
  "vault.error.localIndexExists":
    "Restore is available only when the local index is missing",
  "vault.error.localFilesExist":
    "Restore is available only when the local Vault is empty",
  "vault.error.restoreFailed": "Cloud restore failed",
  "vault.error.sessionExpired": "Your session has expired. Sign in again.",
  "vault.error.permissionDenied":
    "You don't have permission to access the cloud backup",
  "vault.error.serverError":
    "The cloud service is temporarily unavailable. Try again later.",
  "vault.error.resetFailed":
    "Reset failed; your local files and current key were kept",
  "vault.error.resetInProgress":
    "Resetting and reconfiguring your cloud backup",
  "vault.error.restoreInProgress": "A restore is already in progress",
  "vault.reset.discard": "Discard old backup, start fresh",
  "vault.reset.confirmNewDevice":
    "Discard the old backup and create a new Vault? This cannot be undone.",
  "vault.reset.confirmExisting":
    "Discard the old cloud backup and start over? Your local files stay, but the cloud backup is deleted. This cannot be undone.",
  "vault.reset.discardAction": "Discard and start fresh",
  "vault.reset.resetAction": "Reset and reconfigure",
  "vault.reset.localFilesConflict":
    "An existing cloud backup must be discarded before these local files can start a new backup.",
  "vault.reset.retry": "Retry reset",
  "vault.reset.inProgress": "Resetting and reconfiguring your cloud backup…",
  "vault.menu.more": "More Vault actions",
  "vault.menu.advanced": "Advanced actions",
};

vi.mock("react-i18next", () => {
  const translate = (
    key: string,
    options?: {
      count?: number;
      name?: string;
      used?: string;
      quota?: string;
    },
  ) => {
    const pluralKey = options?.count === 1 ? `${key}_one` : `${key}_other`;
    return (TRANSLATIONS[pluralKey] ?? TRANSLATIONS[key] ?? key)
      .replace("{{count}}", String(options?.count ?? ""))
      .replace("{{name}}", options?.name ?? "")
      .replace("{{used}}", options?.used ?? "")
      .replace("{{quota}}", options?.quota ?? "");
  };
  return {
    useTranslation: () => ({
      t: translate,
      i18n: { language: "en" },
    }),
  };
});

function item(name: string, overrides: Partial<VaultSnapshotItem> = {}) {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  return {
    name,
    ext,
    size: 5,
    mtime: 1,
    syncStatus: "pending" as const,
    ...overrides,
  };
}

function snapshot(overrides: Partial<VaultSnapshot> = {}): VaultSnapshot {
  return {
    items: [],
    pendingCount: 0,
    hasLocalIndex: true,
    hasLocalFiles: true,
    hasLocalMek: true,
    operationStatus: "idle",
    usedBytes: 0,
    quotaBytes: 100 * 1024 * 1024,
    ...overrides,
  };
}

describe("VaultView", () => {
  let container: HTMLDivElement;
  let root: Root;
  const api = {
    getSnapshot: vi.fn(async () =>
      snapshot({
        items: [item("readme.md")],
        pendingCount: 1,
        hasLocalIndex: true,
      }),
    ),
    importFile: vi.fn(async () => snapshot({ items: [] })),
    openFile: vi.fn(async () => ({ error: null })),
    revealFile: vi.fn(async () => true),
    exportFile: vi.fn(async () => ({ canceled: false })),
    deleteFile: vi.fn(async () => snapshot({ items: [] })),
    sync: vi.fn(async () => snapshot({ items: [] })),
    checkRemoteBackup: vi.fn(async () => ({ status: "no-backup" })),
    generateRecoveryCode: vi.fn(
      async () => "123456789ABCDEFGHJKLMNPQRSTUVWXYZ",
    ),
    initialize: vi.fn(async () => undefined),
    restoreWithLocalMek: vi.fn(async () => ({ restored: 0, renamed: 0 })),
    restoreWithRecoveryCode: vi.fn(async () => ({ restored: 0, renamed: 0 })),
    beginDiscardAndReinitialize: vi.fn(async () => ({
      recoveryCode: "CODE",
      preservedLocalFiles: 0,
    })),
    completeDiscardAndReinitialize: vi.fn(async () => ({
      deletedObjects: 0,
      preservedLocalFiles: 0,
    })),
    discardRemoteBackupAndStart: vi.fn(async () => ({
      deletedObjects: 0,
      preservedLocalFiles: 0,
    })),
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

  async function renderVault(): Promise<void> {
    await act(async () => {
      root.render(createElement(VaultView));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function uploadButton(): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent === "Upload",
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("Upload button missing");
    }
    return button;
  }

  function vaultMenuButton(): HTMLButtonElement {
    const button = container.querySelector(
      'button[aria-label="More Vault actions"]',
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("Vault menu button missing");
    }
    return button;
  }

  function screenText(): string {
    return container.textContent ?? "";
  }

  it("uses a browser confirmation dialog before deleting a file", async () => {
    const systemConfirm = vi.spyOn(window, "confirm");

    await renderVault();
    const moreButton = container.querySelector(
      'button[aria-label="More actions for readme.md"]',
    );
    expect(moreButton).toBeDefined();
    await act(async () => moreButton!.click());
    const deleteButton = Array.from(
      container.querySelectorAll('[role="menuitem"]'),
    ).find((button) => button.textContent === "Delete");
    expect(deleteButton).toBeDefined();
    await act(async () => deleteButton!.click());

    expect(systemConfirm).not.toHaveBeenCalled();
    expect(screenText()).toContain("Delete readme.md from your Vault?");
    expect(api.deleteFile).not.toHaveBeenCalled();

    const modal = container.querySelector(".modal-overlay");
    expect(modal).not.toBeNull();
    await act(async () => modal!.querySelector("button")!.click());
    expect(api.deleteFile).not.toHaveBeenCalled();

    await act(async () => moreButton!.click());
    const reopenedDeleteButton = Array.from(
      container.querySelectorAll('[role="menuitem"]'),
    ).find((button) => button.textContent === "Delete");
    expect(reopenedDeleteButton).toBeDefined();
    await act(async () => reopenedDeleteButton!.click());
    const reopenedModal = container.querySelector(".modal-overlay");
    expect(reopenedModal).not.toBeNull();
    const confirmButtons = reopenedModal!.querySelectorAll("button");
    await act(async () => {
      confirmButtons[confirmButtons.length - 1].click();
      await Promise.resolve();
    });
    expect(api.deleteFile).toHaveBeenCalledWith("readme.md");
  });

  it("renders local quota usage", async () => {
    api.getSnapshot.mockResolvedValueOnce(
      snapshot({
        usedBytes: 12 * 1024 * 1024,
        quotaBytes: 100 * 1024 * 1024,
      }),
    );

    await act(async () => {
      root.render(createElement(VaultView));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Used 12.0 MB / 100.0 MB");
  });

  it("shows a distinct local quota error", async () => {
    api.importFile.mockRejectedValueOnce(
      new Error("VAULT_LOCAL_QUOTA_EXCEEDED"),
    );

    await renderVault();
    await act(async () => {
      uploadButton().click();
      await Promise.resolve();
    });

    expect(screenText()).toContain("Your local Vault is full");
  });

  it("shows a distinct cloud quota error while keeping local files", async () => {
    api.sync.mockRejectedValueOnce(
      new VaultCloudError(413, "VAULT_QUOTA_EXCEEDED"),
    );

    await renderVault();
    const sync = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Sync",
    );
    expect(sync).toBeDefined();

    await act(async () => {
      sync!.click();
      await Promise.resolve();
    });

    expect(screenText()).toContain("readme.md");
    expect(screenText()).toContain("Cloud backup storage is full");
  });

  it("renders the local snapshot without requiring cloud access", async () => {
    await renderVault();

    expect(api.getSnapshot).toHaveBeenCalledTimes(1);
    expect(api.checkRemoteBackup).not.toHaveBeenCalled();
    expect(screenText()).toContain("readme.md");
    expect(screenText()).toContain("Pending Backup");
  });

  it("opens the advanced menu and confirms reset through the existing flow", async () => {
    await renderVault();

    expect(container.querySelector('[role="menu"]')).toBeNull();
    await act(async () => vaultMenuButton().click());

    const menu = container.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    expect(menu?.textContent).toContain("Advanced actions");
    const reset = Array.from(menu!.querySelectorAll('[role="menuitem"]')).find(
      (item) => item.textContent === "Discard old backup, start fresh",
    );
    expect(reset).toBeDefined();

    await act(async () =>
      reset!.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(screenText()).toContain(
      "Discard the old cloud backup and start over? Your local files stay, but the cloud backup is deleted. This cannot be undone.",
    );
    expect(api.beginDiscardAndReinitialize).not.toHaveBeenCalled();
  });

  it("closes the advanced menu with Escape and returns focus to the trigger", async () => {
    await renderVault();
    const trigger = vaultMenuButton();

    await act(async () => trigger.click());
    const menu = container.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    const reset = menu!.querySelector('[role="menuitem"]') as HTMLButtonElement;
    expect(document.activeElement).toBe(reset);

    await act(async () => {
      reset.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(api.beginDiscardAndReinitialize).not.toHaveBeenCalled();
  });

  it("hides the advanced menu while remote status is unresolved", async () => {
    api.getSnapshot.mockResolvedValueOnce(
      snapshot({
        hasLocalIndex: false,
        hasLocalFiles: false,
        hasLocalMek: false,
      }),
    );
    api.checkRemoteBackup.mockImplementationOnce(() => new Promise(() => {}));

    await renderVault();

    expect(
      container.querySelector('button[aria-label="More Vault actions"]'),
    ).toBeNull();
  });

  it("hides the advanced menu while clicking sync", async () => {
    let resolveSync!: (next: VaultSnapshot) => void;
    api.sync.mockImplementationOnce(
      () =>
        new Promise<VaultSnapshot>((resolve) => {
          resolveSync = resolve;
        }),
    );

    await renderVault();
    const sync = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Sync",
    );
    await act(async () => sync?.click());

    expect(
      container.querySelector('button[aria-label="More Vault actions"]'),
    ).toBeNull();
    await act(async () => resolveSync(snapshot({ items: [] })));
  });

  it("hides the advanced menu during automatic restore", async () => {
    api.getSnapshot.mockResolvedValueOnce(
      snapshot({
        hasLocalIndex: false,
        hasLocalFiles: false,
        hasLocalMek: true,
      }),
    );
    api.checkRemoteBackup.mockResolvedValueOnce({ status: "has-backup" });
    api.restoreWithLocalMek.mockImplementationOnce(() => new Promise(() => {}));

    await renderVault();

    expect(
      container.querySelector('button[aria-label="More Vault actions"]'),
    ).toBeNull();
  });

  it("closes the advanced menu when clicking outside it", async () => {
    await renderVault();
    await act(async () => vaultMenuButton().click());
    expect(container.querySelector('[role="menu"]')).not.toBeNull();

    const title = container.querySelector("h1");
    expect(title).not.toBeNull();
    await act(async () => {
      title!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it("hides the advanced menu while a Vault operation is pending", async () => {
    api.getSnapshot.mockResolvedValueOnce(
      snapshot({ operationStatus: "awaiting-recovery-code" }),
    );

    await renderVault();

    expect(
      container.querySelector('button[aria-label="More Vault actions"]'),
    ).toBeNull();
  });

  it("renders only file, skill, and session categories", async () => {
    await renderVault();

    const tabs = Array.from(container.querySelectorAll("button")).filter(
      (button) =>
        ["Files", "Skills", "Sessions"].includes(button.textContent ?? ""),
    );
    expect(tabs).toHaveLength(3);
    expect(screenText()).not.toContain("All");
    expect(screenText()).not.toContain("Documents");
    expect(screenText()).not.toContain("Other");
    expect(container.querySelector("header")?.textContent).not.toContain(
      "Upload",
    );
    expect(screenText()).toContain("1 file");

    const upload = uploadButton();
    expect(upload.closest("header")).toBeNull();
  });

  it.each(["Skills", "Sessions"])(
    "%s shows the coming-soon state without file actions",
    async (label) => {
      await renderVault();
      const tab = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === label,
      );

      await act(async () => {
        tab?.click();
      });

      expect(screenText()).toContain("Coming soon");
      expect(screenText()).not.toContain("readme.md");
      expect(screenText()).not.toContain("Upload");
    },
  );

  it("keeps file actions inside a closed more-actions menu", async () => {
    await renderVault();

    expect(screenText()).not.toContain("Reveal in Folder");
    const more = container.querySelector(
      'button[aria-label="More actions for readme.md"]',
    );
    expect(more).not.toBeNull();
    expect(more?.getAttribute("aria-expanded")).toBe("false");
    expect(more?.getAttribute("aria-controls")).toBe("vault-menu-readme.md");

    await act(async () => {
      more?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const menu = container.querySelector('[role="menu"]');
    expect(menu?.textContent).toContain("Open");
    expect(menu?.textContent).toContain("Reveal in Folder");
    expect(menu?.textContent).toContain("Export");
    expect(menu?.textContent).toContain("Delete");
    expect(more?.getAttribute("aria-expanded")).toBe("true");
    expect(more?.getAttribute("aria-controls")).toBe("vault-menu-readme.md");
    expect(screenText()).toContain("readme.md");
    expect(screenText()).toContain("Pending Backup");

    await act(async () => {
      more?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(more?.getAttribute("aria-expanded")).toBe("false");
  });

  it("does not offer a new recovery code after initialization", async () => {
    api.getSnapshot.mockResolvedValueOnce(
      snapshot({ hasLocalIndex: true, hasLocalMek: true }),
    );

    await renderVault();

    expect(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Set up encrypted cloud backup",
      ),
    ).toBeUndefined();
  });

  it("starts automatic restore when local is empty and a local MEK exists", async () => {
    api.getSnapshot.mockResolvedValueOnce(
      snapshot({
        items: [],
        pendingCount: 0,
        hasLocalIndex: false,
        hasLocalFiles: false,
        hasLocalMek: true,
      }),
    );
    api.checkRemoteBackup.mockResolvedValueOnce({ status: "has-backup" });

    await renderVault();

    expect(api.restoreWithLocalMek).toHaveBeenCalledWith("token");
    expect(api.restoreWithRecoveryCode).not.toHaveBeenCalled();
  });

  it("does not offer upload during first-time recovery-code setup", async () => {
    api.getSnapshot.mockResolvedValueOnce(
      snapshot({
        items: [],
        pendingCount: 0,
        hasLocalIndex: false,
        hasLocalFiles: false,
        hasLocalMek: false,
      }),
    );
    api.checkRemoteBackup.mockResolvedValueOnce({ status: "no-backup" });

    await renderVault();

    expect(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Upload",
      ),
    ).toBeUndefined();
    expect(screenText()).toContain("Set your recovery code");
  });

  it("does not start setup when remote status is an error", async () => {
    api.getSnapshot.mockResolvedValueOnce(
      snapshot({
        items: [],
        pendingCount: 0,
        hasLocalIndex: false,
        hasLocalFiles: false,
        hasLocalMek: false,
      }),
    );
    api.checkRemoteBackup.mockResolvedValueOnce({
      status: "error",
      errorCode: "VAULT_CLOUD_HTTP_503",
    });

    await renderVault();

    expect(api.generateRecoveryCode).not.toHaveBeenCalled();
    expect(screenText()).toContain("Retry");
    expect(
      container.querySelector('button[aria-label="More Vault actions"]'),
    ).toBeNull();
  });

  it("adopts local files without showing cloud restore", async () => {
    api.getSnapshot.mockResolvedValueOnce(
      snapshot({
        items: [item("local.txt")],
        pendingCount: 1,
        hasLocalIndex: false,
        hasLocalFiles: true,
        hasLocalMek: true,
      }),
    );

    await renderVault();

    expect(api.checkRemoteBackup).not.toHaveBeenCalled();
    expect(screenText()).toContain("local.txt");
  });

  it("shows restore failure and retries automatic restore", async () => {
    api.getSnapshot.mockResolvedValueOnce(
      snapshot({
        items: [],
        pendingCount: 0,
        hasLocalIndex: false,
        hasLocalFiles: false,
        hasLocalMek: true,
      }),
    );
    api.checkRemoteBackup.mockResolvedValueOnce({ status: "has-backup" });
    api.restoreWithLocalMek.mockRejectedValueOnce(new Error("NETWORK_DOWN"));

    await renderVault();
    expect(screenText()).toContain("Restore failed. Try again.");

    api.restoreWithLocalMek.mockResolvedValueOnce({ restored: 1, renamed: 0 });
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry",
    );
    await act(async () => {
      retry?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.restoreWithLocalMek).toHaveBeenCalledTimes(2);
  });

  it("rechecks remote status after a remote-status error", async () => {
    api.getSnapshot.mockResolvedValueOnce(
      snapshot({
        items: [],
        pendingCount: 0,
        hasLocalIndex: false,
        hasLocalFiles: false,
        hasLocalMek: false,
      }),
    );
    api.checkRemoteBackup
      .mockResolvedValueOnce({
        status: "error",
        errorCode: "VAULT_CLOUD_HTTP_503",
      })
      .mockResolvedValueOnce({ status: "no-backup" });

    await renderVault();
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry",
    );
    await act(async () => {
      retry?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.checkRemoteBackup).toHaveBeenCalledTimes(2);
    expect(screenText()).toContain("Set your recovery code");
  });

  it("offers to discard a conflicting remote backup for local files", async () => {
    api.getSnapshot.mockResolvedValueOnce(
      snapshot({
        items: [item("local.txt")],
        pendingCount: 1,
        hasLocalIndex: false,
        hasLocalFiles: true,
        hasLocalMek: false,
      }),
    );
    api.checkRemoteBackup.mockResolvedValueOnce({ status: "has-backup" });

    await renderVault();

    expect(api.checkRemoteBackup).toHaveBeenCalledWith("token");
    expect(screenText()).not.toContain("Discard old backup, start fresh");
    expect(screenText()).toContain("Finish setup");
    await act(async () => vaultMenuButton().click());
    expect(screenText()).toContain("Discard old backup, start fresh");
    expect(uploadButton().disabled).toBe(true);
  });

  it("offers MEK setup when local files exist without an index", async () => {
    api.getSnapshot.mockResolvedValueOnce(
      snapshot({
        items: [item("local.txt")],
        pendingCount: 1,
        hasLocalIndex: false,
        hasLocalFiles: true,
        hasLocalMek: false,
      }),
    );

    await renderVault();

    expect(api.checkRemoteBackup).toHaveBeenCalledWith("token");
    expect(uploadButton().disabled).toBe(true);
    expect(screenText()).toContain("Set up encrypted cloud backup");
    expect(screenText()).toContain("123456789ABCDEFGHJKLMNPQRSTUVWXYZ");
  });

  it("enables upload for an empty Vault with a local MEK and no backup", async () => {
    api.getSnapshot.mockResolvedValueOnce(
      snapshot({
        items: [],
        pendingCount: 0,
        hasLocalIndex: false,
        hasLocalFiles: false,
        hasLocalMek: true,
      }),
    );
    api.checkRemoteBackup.mockResolvedValueOnce({ status: "no-backup" });

    await renderVault();

    expect(uploadButton().disabled).toBe(false);
    expect(screenText()).toContain("No files in your Vault");
  });

  it("accepts a saved recovery code for a new-device restore", async () => {
    api.getSnapshot.mockResolvedValueOnce(
      snapshot({
        items: [],
        pendingCount: 0,
        hasLocalIndex: false,
        hasLocalFiles: false,
        hasLocalMek: false,
      }),
    );
    api.checkRemoteBackup.mockResolvedValueOnce({ status: "has-backup" });

    await renderVault();

    const input = container.querySelector(
      'input[aria-label="Recovery code"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "123456789ABCDEFGHJKLMNPQRSTUVWXYZ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const restore = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Restore",
    );
    expect(restore?.className).toContain("text-accent-foreground");
    expect(restore?.className).toContain("disabled:bg-accent/40");
    expect(restore?.className).not.toContain("disabled:text-text-primary");
    expect(
      Array.from(container.querySelectorAll("button")).filter(
        (button) => button.textContent === "Discard old backup, start fresh",
      ),
    ).toHaveLength(0);
    await act(async () => {
      restore?.click();
      await Promise.resolve();
    });

    expect(api.restoreWithRecoveryCode).toHaveBeenCalledWith(
      "token",
      "123456789ABCDEFGHJKLMNPQRSTUVWXYZ",
    );
  });

  it("offers to discard the old backup on a new device and confirms first", async () => {
    api.getSnapshot.mockResolvedValueOnce(
      snapshot({
        items: [],
        pendingCount: 0,
        hasLocalIndex: false,
        hasLocalFiles: false,
        hasLocalMek: false,
      }),
    );
    api.checkRemoteBackup.mockResolvedValueOnce({ status: "has-backup" });
    const confirmSpy = vi.spyOn(window, "confirm");

    await renderVault();

    await act(async () => vaultMenuButton().click());
    const discard = Array.from(
      container.querySelectorAll('[role="menuitem"]'),
    ).find(
      (button) => button.textContent === "Discard old backup, start fresh",
    );
    expect(discard).toBeDefined();
    await act(async () => {
      discard?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screenText()).toContain(
      "Discard the old backup and create a new Vault? This cannot be undone.",
    );
    expect(api.discardRemoteBackupAndStart).not.toHaveBeenCalled();
    const modal = container.querySelector(".modal-overlay");
    expect(modal).not.toBeNull();
    const modalButtons = modal!.querySelectorAll("button");
    expect(modalButtons[0].textContent).toBe("Cancel");
    expect(modalButtons[modalButtons.length - 1].textContent).toBe(
      "Discard and start fresh",
    );
    await act(async () => modalButtons[0].click());
    expect(api.discardRemoteBackupAndStart).not.toHaveBeenCalled();

    await act(async () => vaultMenuButton().click());
    const reopenedDiscard = Array.from(
      container.querySelectorAll('[role="menuitem"]'),
    ).find(
      (button) => button.textContent === "Discard old backup, start fresh",
    );
    await act(async () => {
      reopenedDiscard?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    const reopenedModal = container.querySelector(".modal-overlay");
    expect(reopenedModal).not.toBeNull();
    const confirmButtons = reopenedModal!.querySelectorAll("button");
    await act(async () => {
      confirmButtons[confirmButtons.length - 1].click();
      await Promise.resolve();
    });
    expect(api.discardRemoteBackupAndStart).toHaveBeenCalledWith("token");
  });

  it("shows the new recovery code setup after resetting an existing Vault", async () => {
    api.getSnapshot.mockResolvedValueOnce(
      snapshot({
        items: [item("local.txt")],
        pendingCount: 0,
        hasLocalIndex: true,
        hasLocalFiles: true,
        hasLocalMek: true,
      }),
    );
    api.beginDiscardAndReinitialize.mockResolvedValueOnce({
      recoveryCode: "NEW-CODE",
      preservedLocalFiles: 1,
    });
    const confirmSpy = vi.spyOn(window, "confirm");

    await renderVault();
    await act(async () => vaultMenuButton().click());
    const discard = Array.from(
      container.querySelectorAll('[role="menuitem"]'),
    ).find(
      (button) => button.textContent === "Discard old backup, start fresh",
    );
    await act(async () => {
      discard?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screenText()).toContain(
      "Discard the old cloud backup and start over? Your local files stay, but the cloud backup is deleted. This cannot be undone.",
    );
    expect(api.beginDiscardAndReinitialize).not.toHaveBeenCalled();
    const modal = container.querySelector(".modal-overlay");
    expect(modal).not.toBeNull();
    const modalButtons = modal!.querySelectorAll("button");
    expect(modalButtons[modalButtons.length - 1].textContent).toBe(
      "Reset and reconfigure",
    );
    const cancel = modal!.querySelector("button");
    await act(async () => cancel?.click());
    expect(api.beginDiscardAndReinitialize).not.toHaveBeenCalled();

    await act(async () => vaultMenuButton().click());
    const reopenedDiscard = Array.from(
      container.querySelectorAll('[role="menuitem"]'),
    ).find(
      (button) => button.textContent === "Discard old backup, start fresh",
    );
    await act(async () => {
      reopenedDiscard?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    const reopenedModal = container.querySelector(".modal-overlay");
    expect(reopenedModal).not.toBeNull();
    const confirmButtons = reopenedModal!.querySelectorAll("button");
    await act(async () => {
      confirmButtons[confirmButtons.length - 1].click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screenText()).toContain("NEW-CODE");
    const checkbox = container.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    const finish = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Finish setup",
    );
    await act(async () => {
      finish?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.initialize).not.toHaveBeenCalled();
    expect(api.completeDiscardAndReinitialize).toHaveBeenCalledWith(
      "token",
      "NEW-CODE",
    );
  });

  it("shows syncing feedback and disables the sync button immediately", async () => {
    let resolveSync!: (snapshot: VaultSnapshot) => void;
    api.sync.mockImplementationOnce(
      () =>
        new Promise<VaultSnapshot>((resolve) => {
          resolveSync = resolve;
        }),
    );

    await renderVault();
    const sync = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Sync",
    );

    await act(async () => {
      sync?.click();
    });

    expect(screenText()).toContain("Syncing…");
    expect(sync?.disabled).toBe(true);
    expect(sync?.className).toContain("text-accent-foreground");
    expect(sync?.className).not.toContain("disabled:text-text-primary");

    await act(async () => {
      resolveSync(snapshot({ items: [] }));
    });
  });

  it("shows sync completion and dismisses it after three seconds", async () => {
    vi.useFakeTimers();
    api.sync.mockResolvedValueOnce(snapshot({ items: [] }));

    await renderVault();
    const sync = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Sync",
    );
    await act(async () => {
      sync?.click();
      await Promise.resolve();
    });

    expect(screenText()).toContain("Sync complete");
    await act(async () => {
      vi.advanceTimersByTime(2999);
    });
    expect(screenText()).toContain("Sync complete");
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screenText()).not.toContain("Sync complete");
  });

  it("keeps a sync failure visible until dismissed", async () => {
    api.sync.mockRejectedValueOnce(new Error("NETWORK_DOWN"));

    await renderVault();
    const sync = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Sync",
    );
    await act(async () => {
      sync?.click();
      await Promise.resolve();
    });

    expect(screenText()).toContain("Cloud sync failed");
    const dismiss = container.querySelector('button[aria-label="Dismiss"]');
    expect(dismiss).not.toBeNull();
    await act(async () => {
      dismiss?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(screenText()).not.toContain("Cloud sync failed");
  });

  it("does not call sync when the user is logged out", async () => {
    useAppStore.setState({ cloudConfig: null });

    await renderVault();
    const sync = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Sync",
    );
    await act(async () => {
      sync?.click();
    });

    expect(api.sync).not.toHaveBeenCalled();
    expect(screenText()).toContain("Sign in to sync your Vault");
    expect(
      container.querySelector('button[aria-label="More Vault actions"]'),
    ).toBeNull();
  });

  it("shows already latest when no files were pending", async () => {
    api.getSnapshot.mockResolvedValueOnce(snapshot({ items: [] }));
    api.sync.mockResolvedValueOnce(snapshot({ items: [] }));

    await renderVault();
    const sync = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Sync",
    );
    await act(async () => {
      sync?.click();
      await Promise.resolve();
    });

    expect(screenText()).toContain("Already up to date");
  });

  it("treats a resolved snapshot with pending files as a sync failure", async () => {
    api.sync.mockResolvedValueOnce(snapshot({ items: [], pendingCount: 1 }));

    await renderVault();
    const sync = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Sync",
    );
    await act(async () => {
      sync?.click();
      await Promise.resolve();
    });

    expect(screenText()).toContain("Cloud sync failed");
  });

  it("maps a 401 sync error to a re-login message", async () => {
    api.sync.mockRejectedValueOnce(new Error("VAULT_CLOUD_HTTP_401"));

    await renderVault();
    const sync = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Sync",
    );
    await act(async () => {
      sync?.click();
      await Promise.resolve();
    });

    expect(screenText()).toContain("Your session has expired");
  });

  it("maps a 403 sync error to a permission message", async () => {
    api.sync.mockRejectedValueOnce(new Error("VAULT_CLOUD_HTTP_403"));

    await renderVault();
    const sync = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Sync",
    );
    await act(async () => {
      sync?.click();
      await Promise.resolve();
    });

    expect(screenText()).toContain("permission");
  });

  it("maps a 503 sync error to a retry-later message", async () => {
    api.sync.mockRejectedValueOnce(new Error("VAULT_CLOUD_HTTP_503"));

    await renderVault();
    const sync = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Sync",
    );
    await act(async () => {
      sync?.click();
      await Promise.resolve();
    });

    expect(screenText()).toContain("temporarily unavailable");
  });

  it("uploads through high-level IPC without receiving file bytes", async () => {
    await renderVault();
    const upload = uploadButton();

    await act(async () => {
      upload?.click();
    });

    expect(api.importFile).toHaveBeenCalledTimes(1);
    expect(api.importFile.mock.calls[0]).toHaveLength(0);
  });
});
