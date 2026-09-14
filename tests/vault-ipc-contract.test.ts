import { afterEach, describe, expect, it, vi } from "vitest";
import { ipcMain } from "electron";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VaultIpcDependencies } from "../src/main/vault/ipc";
import {
  classifyRemoteBackupError,
  registerVaultIpc,
} from "../src/main/vault/ipc";
import { VaultCloudError } from "../src/main/vault/cloud-client";
import { LocalVaultStore } from "../src/main/vault/local-store";
import type { VaultSnapshot } from "../src/shared/vault";

describe("Vault IPC contract", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("registers only high-level local-first commands", () => {
    const channels: string[] = [];
    const handle = vi.spyOn(ipcMain, "handle").mockImplementation((channel) => {
      channels.push(channel);
      return undefined as never;
    });

    registerVaultIpc();

    expect(channels).toEqual([
      "vault.getSnapshot",
      "vault.importFile",
      "vault.openFile",
      "vault.getFilePath",
      "vault.revealFile",
      "vault.exportFile",
      "vault.deleteFile",
      "vault.sync",
      "vault.checkRemoteBackup",
      "vault.getBackupUsage",
      "vault.generateRecoveryCode",
      "vault.initialize",
      "vault.restoreWithLocalMek",
      "vault.restoreWithRecoveryCode",
      "vault.beginDiscardAndReinitialize",
      "vault.completeDiscardAndReinitialize",
      "vault.discardRemoteBackupAndStart",
    ]);
    expect(channels).toContain("vault.restoreWithLocalMek");
    expect(channels).toContain("vault.restoreWithRecoveryCode");
    expect(channels).not.toContain("vault.restore");
    expect(channels).not.toContain("vault.encryptUpload");
    expect(channels).not.toContain("vault.decryptRestore");
    expect(channels).not.toContain("vault.getMek");
    handle.mockRestore();
  });

  it("resolves a vault file name to an absolute path inside the vault root", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi
      .spyOn(ipcMain, "handle")
      .mockImplementation((channel, listener) => {
        handlers.set(channel, listener);
        return undefined as never;
      });

    const { store, dependencies } = await makeDependencies(
      Buffer.from("mek"),
      true,
    );
    registerVaultIpc(dependencies);

    await expect(
      handlers.get("vault.getFilePath")?.(null, "readme.md"),
    ).resolves.toBe(join(store.rootDir, "readme.md"));
    await expect(
      handlers.get("vault.getFilePath")?.(null, "../secret"),
    ).rejects.toThrow("VAULT_INVALID_NAME");
    await expect(
      handlers.get("vault.getFilePath")?.(null, "nested/readme.md"),
    ).rejects.toThrow("VAULT_INVALID_NAME");
    await expect(
      handlers.get("vault.getFilePath")?.(null, "vault-mek.bin."),
    ).rejects.toThrow("VAULT_INVALID_NAME");
    handle.mockRestore();
  });

  it("keeps remote errors distinct from an empty backup", () => {
    const result = classifyRemoteBackupError(new VaultCloudError(503));
    expect(result).toEqual({
      status: "error",
      errorCode: "VAULT_CLOUD_HTTP_503",
    });
    expect(result.status).not.toBe("no-backup");
  });

  it("exposes local-file and local-MEK presence in the snapshot", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi
      .spyOn(ipcMain, "handle")
      .mockImplementation((channel, listener) => {
        handlers.set(channel, listener);
        return undefined as never;
      });

    const { store, dependencies } = await makeDependencies(
      Buffer.from("mek"),
      true,
    );
    registerVaultIpc(dependencies);

    const snapshot = (await handlers.get(
      "vault.getSnapshot",
    )?.()) as VaultSnapshot;
    expect(snapshot.hasLocalFiles).toBe(true);
    expect(snapshot.hasLocalMek).toBe(true);
    expect(snapshot.items.map((item) => item.name)).toEqual(["readme.md"]);
    handle.mockRestore();
  });

  it("reports a missing remote backup without an error code", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi
      .spyOn(ipcMain, "handle")
      .mockImplementation((channel, listener) => {
        handlers.set(channel, listener);
        return undefined as never;
      });

    const { dependencies } = await makeDependencies(Buffer.from("mek"), true);
    dependencies.cloud.getIndex = async () => null;
    registerVaultIpc(dependencies);

    const fromHandler = (await handlers.get("vault.checkRemoteBackup")?.(
      "token",
    )) as unknown;
    expect(fromHandler).toEqual({ status: "no-backup" });
    handle.mockRestore();
  });

  it("exposes a remote HTTP error as a distinct status", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi
      .spyOn(ipcMain, "handle")
      .mockImplementation((channel, listener) => {
        handlers.set(channel, listener);
        return undefined as never;
      });

    const { dependencies } = await makeDependencies(Buffer.from("mek"), false);
    dependencies.cloud.getIndex = async () => {
      throw new VaultCloudError(503);
    };
    registerVaultIpc(dependencies);

    const status = await handlers.get("vault.checkRemoteBackup")?.("token");
    expect(status).toEqual({
      status: "error",
      errorCode: "VAULT_CLOUD_HTTP_503",
    });
    handle.mockRestore();
  });

  it("returns null usage without a token", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi
      .spyOn(ipcMain, "handle")
      .mockImplementation((channel, listener) => {
        handlers.set(channel, listener);
        return undefined as never;
      });

    const { dependencies } = await makeDependencies(Buffer.from("mek"), true);
    registerVaultIpc(dependencies);

    await expect(
      handlers.get("vault.getBackupUsage")?.(null, null),
    ).resolves.toBeNull();
    handle.mockRestore();
  });

  it("passes cloud usage through and degrades failures to null", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi
      .spyOn(ipcMain, "handle")
      .mockImplementation((channel, listener) => {
        handlers.set(channel, listener);
        return undefined as never;
      });

    const { dependencies } = await makeDependencies(Buffer.from("mek"), true);
    dependencies.cloud.getUsage = async () => ({
      usedBytes: 1536,
      quotaBytes: 104857600,
    });
    registerVaultIpc(dependencies);

    await expect(
      handlers.get("vault.getBackupUsage")?.(null, "token"),
    ).resolves.toEqual({ usedBytes: 1536, quotaBytes: 104857600 });

    dependencies.cloud.getUsage = async () => {
      throw new VaultCloudError(503);
    };

    await expect(
      handlers.get("vault.getBackupUsage")?.(null, "token"),
    ).resolves.toBeNull();
    handle.mockRestore();
  });
});

async function makeDependencies(
  mek: Buffer,
  withLocalFile: boolean,
): Promise<{ store: LocalVaultStore; dependencies: VaultIpcDependencies }> {
  const root = await mkdtemp(join(tmpdir(), "deskwand-vault-ipc-"));
  const store = new LocalVaultStore(join(root, "vault"));
  await store.ensureDirectory();
  if (withLocalFile) {
    await writeFile(join(store.rootDir, "readme.md"), "hello");
  }
  const cloud: VaultIpcDependencies["cloud"] = {
    getIndex: async () => Buffer.alloc(10),
    putObject: async () => {},
    getObject: async () => Buffer.alloc(10),
    deleteObject: async () => {},
    putIndex: async () => {},
    listObjectIds: async () => [],
  };
  const syncService: VaultIpcDependencies["syncService"] = {
    sync: async () => ({ uploaded: 0, deleted: 0, pending: 0, failed: 0 }),
  };
  const restoreService: VaultIpcDependencies["restoreService"] = {
    restoreWithLocalMek: async () => ({ restored: 0, renamed: 0 }),
    restoreWithRecoveryCode: async () => ({ restored: 0, renamed: 0 }),
  };
  const resetService: VaultIpcDependencies["resetService"] = {
    beginDiscardAndReinitialize: async () => ({
      recoveryCode: "code",
      preservedLocalFiles: 0,
    }),
    completeDiscardAndReinitialize: async () => ({
      deletedObjects: 0,
      preservedLocalFiles: 0,
    }),
    discardWithoutLocalKey: async () => ({
      deletedObjects: 0,
      preservedLocalFiles: 0,
    }),
  };
  return {
    store,
    dependencies: {
      store,
      cloud,
      syncService,
      restoreService,
      resetService,
      getLocalMek: () => mek,
    },
  };
}
