import { safeStorage } from "electron";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { log } from "../../../utils/logger";
import type { WeChatTokenStore } from "./wechat-channel";

export interface WeChatSecureStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface StoredToken {
  version: 1;
  ciphertext: string;
}

export class SecureWeChatTokenStore implements WeChatTokenStore {
  private readonly storage: WeChatSecureStorage;

  constructor(
    private readonly rootDirectory: string,
    storage: WeChatSecureStorage = safeStorage,
  ) {
    this.storage = storage;
  }

  async load(instanceId: string): Promise<string | null> {
    const file = this.fileFor(instanceId);
    try {
      const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
      if (!isStoredToken(raw)) return null;
      if (!this.storage.isEncryptionAvailable()) {
        log("[SecureWeChatTokenStore] safeStorage unavailable, returning null");
        return null;
      }
      return this.storage.decryptString(Buffer.from(raw.ciphertext, "base64"));
    } catch (error) {
      if (isMissingFile(error)) return null;
      // Decryption failed (e.g. Keychain cleared, app identity changed).
      // The stored ciphertext is irrecoverable — remove the orphaned file.
      log("[SecureWeChatTokenStore] Decryption failed, removing orphaned token");
      try {
        await rm(file, { force: true });
      } catch {
        /* best effort */
      }
      return null;
    }
  }

  async save(instanceId: string, token: string): Promise<void> {
    if (!this.storage.isEncryptionAvailable()) {
      throw new Error("WECHAT_SECURE_STORAGE_UNAVAILABLE");
    }
    const file = this.fileFor(instanceId);
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    const encrypted: StoredToken = {
      version: 1,
      ciphertext: this.storage.encryptString(token).toString("base64"),
    };
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(encrypted)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(temporary, 0o600);
    await rename(temporary, file);
    await chmod(file, 0o600);
  }

  async clear(instanceId: string): Promise<void> {
    await rm(this.fileFor(instanceId), { force: true });
  }

  private fileFor(instanceId: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(instanceId)) {
      throw new Error("WECHAT_INVALID_INSTANCE_ID");
    }
    return join(this.rootDirectory, `${instanceId}.json`);
  }
}

function isStoredToken(value: unknown): value is StoredToken {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1 && typeof record.ciphertext === "string";
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
