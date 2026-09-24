import { afterEach, describe, expect, it, vi } from "vitest";
import { app, ipcMain } from "electron";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VaultIpcDependencies } from "../src/main/vault/ipc";
import {
  classifyRemoteBackupError,
  registerVaultIpc,
} from "../src/main/vault/ipc";
import { VaultCloudError } from "../src/main/vault/cloud-client";
import { LocalVaultStore } from "../src/main/vault/local-store";
import { VaultSkillsStore } from "../src/main/vault/skills-vault";
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
      "vault.addSkillsToVault",
      "vault.deleteSkillFromVault",
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
    ).resolves.toBe(join(store.rootDir, "files", "readme.md"));
    await expect(
      handlers.get("vault.getFilePath")?.(null, "项目/笔记.md"),
    ).resolves.toBe(join(store.rootDir, "files", "项目", "笔记.md"));
    await expect(
      handlers.get("vault.getFilePath")?.(null, "../secret"),
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
    expect(snapshot.items.map((item) => item.path)).toEqual(["readme.md"]);
    handle.mockRestore();
  });

  it("lists nested file paths relative to the files module", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi
      .spyOn(ipcMain, "handle")
      .mockImplementation((channel, listener) => {
        handlers.set(channel, listener);
        return undefined as never;
      });

    const { store, dependencies } = await makeDependencies(
      Buffer.from("mek"),
      false,
    );
    await mkdir(join(store.moduleRoot("files"), "项目"), { recursive: true });
    await writeFile(
      join(store.moduleRoot("files"), "项目", "笔记.md"),
      "note",
    );
    registerVaultIpc(dependencies);

    const snapshot = (await handlers.get(
      "vault.getSnapshot",
    )?.()) as VaultSnapshot;
    expect(snapshot.items.map((item) => item.path)).toContain("项目/笔记.md");
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

    const fromHandler = (await handlers.get("vault.checkRemoteBackup")(
      null,
      "token",
    )) as { status: string };
    // 单一远端索引槽没有备份时 status 是 no-backup，而不是错误
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

    const status = (await handlers.get("vault.checkRemoteBackup")?.(
      null,
      "token",
    )) as { status: string; errorCode?: string };
    expect(status.status).toBe("error");
    expect(status.errorCode).toBe("VAULT_CLOUD_HTTP_503");
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

  it("returns null when the backend cannot report usage", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi
      .spyOn(ipcMain, "handle")
      .mockImplementation((channel, listener) => {
        handlers.set(channel, listener);
        return undefined as never;
      });

    // makeDependencies' cloud double deliberately omits the optional getUsage.
    const { dependencies } = await makeDependencies(Buffer.from("mek"), true);
    expect(dependencies.cloud.getUsage).toBeUndefined();
    registerVaultIpc(dependencies);

    await expect(
      handlers.get("vault.getBackupUsage")?.(null, "token"),
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
  it("reports a single remote backup status", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi
      .spyOn(ipcMain, "handle")
      .mockImplementation((channel, listener) => {
        handlers.set(channel, listener);
        return undefined as never;
      });
    const { dependencies } = await makeDependencies(Buffer.from("mek"), false);
    const tokens: string[] = [];
    dependencies.cloud.getIndex = async (token: string) => {
      tokens.push(token);
      return Buffer.alloc(5);
    };
    registerVaultIpc(dependencies);

    const status = await handlers.get("vault.checkRemoteBackup")?.(
      null,
      "token",
    );

    expect(status).toEqual({ status: "has-backup" });
    // 单一远端索引槽：只查一次，查询不再带 scope
    expect(tokens).toEqual(["token"]);

    dependencies.cloud.getIndex = async () => null;
    await expect(
      handlers.get("vault.checkRemoteBackup")?.(null, "token"),
    ).resolves.toEqual({ status: "no-backup" });
    handle.mockRestore();
  });

  it("skips the restore when the vault already has local content", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi
      .spyOn(ipcMain, "handle")
      .mockImplementation((channel, listener) => {
        handlers.set(channel, listener);
        return undefined as never;
      });
    const { store, dependencies } = await makeDependencies(
      Buffer.from("mek"),
      false,
    );
    // 本地已有索引 → 跳过，不覆盖用户在本机已有的内容
    await store.writeIndex({ version: 2, files: {}, pendingDeletes: [] });
    const restore = vi.fn(dependencies.restoreService.restoreWithLocalMek);
    dependencies.restoreService.restoreWithLocalMek = restore;
    registerVaultIpc(dependencies);

    const result = await handlers.get("vault.restoreWithLocalMek")?.(
      null,
      "token",
    );

    expect(result).toEqual({ restored: 0, renamed: 0 });
    expect(restore).not.toHaveBeenCalled();
    handle.mockRestore();
  });

  it("reports a name clash instead of moving the skill", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi
      .spyOn(ipcMain, "handle")
      .mockImplementation((channel, listener) => {
        handlers.set(channel, listener);
        return undefined as never;
      });
    const { dependencies } = await makeDependencies(Buffer.from("mek"), false);
    const globalSkills = dependencies.globalSkillsPath();
    await mkdir(join(globalSkills, "foo"), { recursive: true });
    await writeFile(join(globalSkills, "foo", "SKILL.md"), "# foo");
    const skillsRoot = dependencies.store.moduleRoot("skills");
    await mkdir(join(skillsRoot, "foo"), {
      recursive: true,
    });
    await writeFile(join(skillsRoot, "foo", "SKILL.md"), "# existing");
    registerVaultIpc(dependencies);

    const result = (await handlers.get("vault.addSkillsToVault")?.(
      null,
      ["foo"],
      true,
    )) as { added: string[]; failed: Array<{ reason: string }> };

    expect(result.added).toEqual([]);
    expect(result.failed[0].reason).toContain("VAULT_SKILL_NAME_TAKEN");
    // 失败者的本地原件不动
    await expect(stat(join(globalSkills, "foo"))).resolves.toBeTruthy();
    handle.mockRestore();
  });
  it("syncs the whole vault with a single call", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi
      .spyOn(ipcMain, "handle")
      .mockImplementation((channel, listener) => {
        handlers.set(channel, listener);
        return undefined as never;
      });
    const { store, dependencies } = await makeDependencies(
      Buffer.from("mek"),
      false,
    );
    // 一次同步覆盖整个密库：files 条目与 skills 聚合都在同一份索引里
    const filesRoot = store.moduleRoot("files");
    await mkdir(filesRoot, { recursive: true });
    await writeFile(join(filesRoot, "note.md"), "note");
    const skillsRoot = store.moduleRoot("skills");
    await mkdir(join(skillsRoot, "foo"), { recursive: true });
    await writeFile(join(skillsRoot, "foo", "SKILL.md"), "# foo");
    const sync = vi.fn(async () => ({
      uploaded: 0,
      deleted: 0,
      pending: 0,
      failed: 0,
    }));
    dependencies.syncService.sync = sync;
    registerVaultIpc(dependencies);

    const snapshot = (await handlers.get("vault.sync")?.(
      null,
      "token",
    )) as VaultSnapshot;

    expect(sync).toHaveBeenCalledTimes(1);
    expect(snapshot.items.map((item) => item.path)).toContain("note.md");
    expect(snapshot.skills?.map((skill) => skill.name)).toContain("foo");
    handle.mockRestore();
  });

  it("throws when the sync reports an error code", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi
      .spyOn(ipcMain, "handle")
      .mockImplementation((channel, listener) => {
        handlers.set(channel, listener);
        return undefined as never;
      });
    const { dependencies } = await makeDependencies(Buffer.from("mek"), false);
    dependencies.syncService.sync = async () => ({
      uploaded: 1,
      deleted: 0,
      pending: 1,
      failed: 1,
      errorCode: "VAULT_QUOTA_EXCEEDED",
    });
    registerVaultIpc(dependencies);

    await expect(
      handlers.get("vault.sync")?.(null, "token"),
    ).rejects.toThrow("VAULT_QUOTA_EXCEEDED");
    handle.mockRestore();
  });

  it("skips the restore when the remote has no backup", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi
      .spyOn(ipcMain, "handle")
      .mockImplementation((channel, listener) => {
        handlers.set(channel, listener);
        return undefined as never;
      });
    const { dependencies } = await makeDependencies(Buffer.from("mek"), false);
    const restore = vi.fn(async () => {
      throw new Error("VAULT_NO_REMOTE_BACKUP");
    });
    dependencies.restoreService.restoreWithLocalMek = restore;
    registerVaultIpc(dependencies);

    const result = await handlers.get("vault.restoreWithLocalMek")?.(
      null,
      "token",
    );

    // 「没有远端备份」不是失败：返回 0/0 而不是抛错
    expect(result).toEqual({ restored: 0, renamed: 0 });
    expect(restore).toHaveBeenCalledTimes(1);
    handle.mockRestore();
  });

  it("propagates a real restore failure", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi
      .spyOn(ipcMain, "handle")
      .mockImplementation((channel, listener) => {
        handlers.set(channel, listener);
        return undefined as never;
      });
    const { dependencies } = await makeDependencies(Buffer.from("mek"), false);
    dependencies.restoreService.restoreWithLocalMek = async () => {
      throw new Error("VAULT_CLOUD_HTTP_503");
    };
    registerVaultIpc(dependencies);

    await expect(
      handlers.get("vault.restoreWithLocalMek")?.(null, "token"),
    ).rejects.toThrow("VAULT_CLOUD_HTTP_503");
    handle.mockRestore();
  });

  it("counts pending skills in the unified pending count", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi
      .spyOn(ipcMain, "handle")
      .mockImplementation((channel, listener) => {
        handlers.set(channel, listener);
        return undefined as never;
      });
    const { dependencies } = await makeDependencies(Buffer.from("mek"), false);
    const skillsRoot = dependencies.store.moduleRoot("skills");
    await mkdir(join(skillsRoot, "foo"), {
      recursive: true,
    });
    await writeFile(join(skillsRoot, "foo", "SKILL.md"), "# foo");
    registerVaultIpc(dependencies);

    const snapshot = (await handlers.get("vault.getSnapshot")?.()) as {
      pendingCount: number;
      skills: Array<{ name: string }>;
    };

    // 技能未同步 → pendingCount 必须 > 0，否则点同步会显示「已是最新」
    expect(snapshot.skills).toHaveLength(1);
    expect(snapshot.pendingCount).toBeGreaterThan(0);
    handle.mockRestore();
  });
  it("notifies on a successful skill upload", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi
      .spyOn(ipcMain, "handle")
      .mockImplementation((channel, listener) => {
        handlers.set(channel, listener);
        return undefined as never;
      });
    const { dependencies } = await makeDependencies(Buffer.from("mek"), false);
    const globalSkills = dependencies.globalSkillsPath();
    await mkdir(join(globalSkills, "foo"), { recursive: true });
    await writeFile(join(globalSkills, "foo", "SKILL.md"), "# foo");
    const onSkillsChanged = vi.fn();
    registerVaultIpc({ ...dependencies, onSkillsChanged });

    await handlers.get("vault.addSkillsToVault")?.(null, ["foo"], true);

    expect(onSkillsChanged).toHaveBeenCalledTimes(1);
    handle.mockRestore();
  });

  it("does not notify when the upload fails", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi
      .spyOn(ipcMain, "handle")
      .mockImplementation((channel, listener) => {
        handlers.set(channel, listener);
        return undefined as never;
      });
    const { dependencies } = await makeDependencies(Buffer.from("mek"), false);
    // 密库里已经同名 → 上传必然抛 VAULT_SKILL_NAME_TAKEN
    const skillsRoot = dependencies.store.moduleRoot("skills");
    await mkdir(join(skillsRoot, "foo"), {
      recursive: true,
    });
    await writeFile(join(skillsRoot, "foo", "SKILL.md"), "# existing");
    const globalSkills = dependencies.globalSkillsPath();
    await mkdir(join(globalSkills, "foo"), { recursive: true });
    await writeFile(join(globalSkills, "foo", "SKILL.md"), "# foo");
    const onSkillsChanged = vi.fn();
    registerVaultIpc({ ...dependencies, onSkillsChanged });

    await handlers.get("vault.addSkillsToVault")?.(null, ["foo"], true);
    expect(onSkillsChanged).not.toHaveBeenCalled();
    handle.mockRestore();
  });

  it("notifies once when a restore recovered content", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi
      .spyOn(ipcMain, "handle")
      .mockImplementation((channel, listener) => {
        handlers.set(channel, listener);
        return undefined as never;
      });
    const { dependencies } = await makeDependencies(Buffer.from("mek"), false);
    dependencies.restoreService.restoreWithLocalMek = async () => ({
      restored: 2,
      renamed: 0,
    });
    const onSkillsChanged = vi.fn();
    registerVaultIpc({ ...dependencies, onSkillsChanged });

    await handlers.get("vault.restoreWithLocalMek")?.(null, "token");

    // 恢复是单入口的：一次恢复只发一次通知
    expect(onSkillsChanged).toHaveBeenCalledTimes(1);
    handle.mockRestore();
  });

  it("does not notify when a restore had nothing to restore", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi
      .spyOn(ipcMain, "handle")
      .mockImplementation((channel, listener) => {
        handlers.set(channel, listener);
        return undefined as never;
      });
    const { dependencies } = await makeDependencies(Buffer.from("mek"), false);
    // 单入口恢复被跳过（无远端备份）→ restored 为 0 → 不该失效所有 SDK 会话
    dependencies.restoreService.restoreWithLocalMek = async () => {
      throw new Error("VAULT_NO_REMOTE_BACKUP");
    };
    const onSkillsChanged = vi.fn();
    registerVaultIpc({ ...dependencies, onSkillsChanged });

    await handlers.get("vault.restoreWithLocalMek")?.(null, "token");

    expect(onSkillsChanged).not.toHaveBeenCalled();
    handle.mockRestore();
  });

  it("keeps defaults when only some dependencies are injected", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi
      .spyOn(ipcMain, "handle")
      .mockImplementation((channel, listener) => {
        handlers.set(channel, listener);
        return undefined as never;
      });
    const onSkillsChanged = vi.fn();

    // 只传一个回调：其余依赖必须回落到默认值，而不是变成 undefined
    registerVaultIpc({ onSkillsChanged });

    // 必须真的执行一次依赖默认值的通道 —— 只断言「通道已注册」证明不了合并语义：
    // 注册只是登记闭包，不触碰依赖。合并语义缺失时这里会因为 skillsVault 为
    // undefined 抛 TypeError。
    //
    // 断言用确定值（而不是 expect.any(Array)）：默认全局技能目录由
    // app.getPath("home") 决定，测试替身把它指向 /tmp/deskwand-test，所以可以
    // 事先在那个目录放一个技能并断言它被列出来 —— 这同时证明了「回落到了默认
    // skillsVault + 默认 globalSkillsPath」而不是读了别处。
    const defaultSkillsDir = join(app.getPath("home"), ".deskwand", "skills");
    const defaultVaultDir = join(
      app.getPath("home"),
      ".deskwand",
      "vault",
    );
    // 两个默认目录都要清：上次运行搬进去的同名技能会让这次变成 NAME_TAKEN
    await rm(defaultSkillsDir, { recursive: true, force: true });
    await rm(defaultVaultDir, { recursive: true, force: true });
    await mkdir(join(defaultSkillsDir, "from-defaults"), { recursive: true });
    await writeFile(
      join(defaultSkillsDir, "from-defaults", "SKILL.md"),
      "# from defaults",
    );

    const result = (await handlers.get("vault.addSkillsToVault")?.(
      null,
      ["from-defaults"],
      true,
    )) as { added: string[] };

    expect(result.added).toEqual(["from-defaults"]);

    await rm(defaultSkillsDir, { recursive: true, force: true });
    await rm(defaultVaultDir, { recursive: true, force: true });
    handle.mockRestore();
  });
  it("moves the selected skills and notifies once", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi
      .spyOn(ipcMain, "handle")
      .mockImplementation((channel, listener) => {
        handlers.set(channel, listener);
        return undefined as never;
      });
    const { dependencies } = await makeDependencies(Buffer.from("mek"), false);
    const globalSkills = dependencies.globalSkillsPath();
    for (const name of ["one", "two"]) {
      await mkdir(join(globalSkills, name), { recursive: true });
      await writeFile(join(globalSkills, name, "SKILL.md"), `# ${name}`);
    }
    const onSkillsChanged = vi.fn();
    registerVaultIpc({ ...dependencies, onSkillsChanged });

    const result = (await handlers.get("vault.addSkillsToVault")?.(
      null,
      ["one", "two"],
      true,
    )) as { added: string[] };

    expect(result.added).toEqual(["one", "two"]);
    expect(onSkillsChanged).toHaveBeenCalledTimes(1);
    handle.mockRestore();
  });

  it("does not notify when nothing was moved", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi
      .spyOn(ipcMain, "handle")
      .mockImplementation((channel, listener) => {
        handlers.set(channel, listener);
        return undefined as never;
      });
    const { dependencies } = await makeDependencies(Buffer.from("mek"), false);
    // 所选技能都不存在 → 全部失败 → 不该失效会话
    const onSkillsChanged = vi.fn();
    registerVaultIpc({ ...dependencies, onSkillsChanged });

    const result = (await handlers.get("vault.addSkillsToVault")?.(
      null,
      ["missing"],
      true,
    )) as { added: string[]; failed: unknown[] };

    expect(result.added).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(onSkillsChanged).not.toHaveBeenCalled();
    handle.mockRestore();
  });

  it("returns the pending confirmation without touching disk", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi
      .spyOn(ipcMain, "handle")
      .mockImplementation((channel, listener) => {
        handlers.set(channel, listener);
        return undefined as never;
      });
    const { dependencies } = await makeDependencies(Buffer.from("mek"), false);
    const globalSkills = dependencies.globalSkillsPath();
    // globalSkills 是跨用例共享的固定目录，先清掉上次运行留下的链接（否则 EEXIST）
    await rm(join(globalSkills, "linked"), { recursive: true, force: true });
    await mkdir(join(globalSkills, "linked"), { recursive: true });
    await writeFile(join(globalSkills, "linked", "SKILL.md"), "# linked");
    await symlink("missing", join(globalSkills, "linked", "dangling"));
    registerVaultIpc(dependencies);

    const result = (await handlers.get("vault.addSkillsToVault")?.(null, [
      "linked",
    ])) as { needsConfirmation?: Array<{ name: string }>; added: string[] };

    expect(result.needsConfirmation).toEqual([
      { name: "linked", symlinkedEntries: ["dangling"] },
    ]);
    expect(result.added).toEqual([]);
    await expect(stat(join(globalSkills, "linked"))).resolves.toBeTruthy();
    handle.mockRestore();
  });

  it("includes the addable skills in the snapshot", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi
      .spyOn(ipcMain, "handle")
      .mockImplementation((channel, listener) => {
        handlers.set(channel, listener);
        return undefined as never;
      });
    const { dependencies } = await makeDependencies(Buffer.from("mek"), false);
    const globalSkills = dependencies.globalSkillsPath();
    // 断言的是完整列表：先清空共享目录，避免别的用例留下的技能混进来
    await rm(globalSkills, { recursive: true, force: true });
    await mkdir(join(globalSkills, "addable"), { recursive: true });
    await writeFile(
      join(globalSkills, "addable", "SKILL.md"),
      "---\nname: addable\ndescription: 可加入\n---\n# x\n",
    );
    registerVaultIpc(dependencies);

    const snapshot = (await handlers.get("vault.getSnapshot")?.(null)) as {
      addableSkills?: Array<{ name: string; description: string }>;
    };

    expect(snapshot.addableSkills).toEqual([
      { name: "addable", description: "可加入" },
    ]);
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
    await mkdir(store.moduleRoot("files"), { recursive: true });
    await writeFile(join(store.moduleRoot("files"), "readme.md"), "hello");
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
  const skillsVault = new VaultSkillsStore(store);
  const globalSkills = join(root, "global-skills");
  await mkdir(globalSkills, { recursive: true });
  return {
    store,
    dependencies: {
      store,
      cloud,
      syncService,
      restoreService,
      resetService,
      getLocalMek: () => mek,
      skillsVault,
      globalSkillsPath: () => globalSkills,
    },
  };
}
