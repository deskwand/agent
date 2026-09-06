import { describe, expect, it, vi } from "vitest";
import { ipcMain } from "electron";
import { registerVaultIpc } from "../src/main/vault/ipc";

describe("Vault IPC contract", () => {
  it("registers only high-level local-first commands", () => {
    const channels: string[] = [];
    const handle = vi.spyOn(ipcMain, "handle").mockImplementation((channel) => {
      channels.push(channel);
    });

    registerVaultIpc();

    expect(channels).toEqual([
      "vault.getSnapshot",
      "vault.importFile",
      "vault.openFile",
      "vault.revealFile",
      "vault.exportFile",
      "vault.deleteFile",
      "vault.sync",
      "vault.checkRemoteBackup",
      "vault.generateRecoveryCode",
      "vault.initialize",
      "vault.restore",
    ]);
    expect(channels).not.toContain("vault.encryptUpload");
    expect(channels).not.toContain("vault.decryptRestore");
    handle.mockRestore();
  });
});
