import { safeStorage } from "electron";
import { randomBytes } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { log, logWarn } from "../../utils/logger";

export interface RuntimeSecureStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

const KEY_FILE = "runtime-state-key.enc";
const KEY_BYTES = 32;

interface EncryptedKey {
  version: 1;
  ciphertext: string;
}

/** Plaintext fallback payload (used only when safeStorage is unavailable). */
interface PlaintextKey {
  version: 1;
  format: "plaintext";
  key: string;
}

/**
 * Stores the Runtime payload-encryption key using Electron safeStorage.
 *
 * Creation is race-safe without a lock file: each contender fully writes a
 * unique 0600 temporary file, then atomically hard-links it to the final path.
 * Exactly one link can create the final path; losers load the winning key.
 * A crashed creator can only leave an unreferenced temporary file, never a
 * stale lock or a partially replaced key.
 */
export class RuntimeKeyStore {
  private readonly secretsDir: string;
  private loadPromise: Promise<Buffer> | null = null;

  constructor(
    userDataPath: string,
    private readonly storage: RuntimeSecureStorage = safeStorage,
  ) {
    this.secretsDir = join(userDataPath, "channel-secrets");
  }

  async loadOrCreate(): Promise<Buffer> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.doLoadOrCreate();
    try {
      return await this.loadPromise;
    } finally {
      this.loadPromise = null;
    }
  }

  private async doLoadOrCreate(): Promise<Buffer> {
    const encryptionAvailable = this.storage.isEncryptionAvailable();

    // safeStorage unavailable: use the plaintext fallback file format
    // (0600 permissions). If an encrypted key already exists we cannot
    // decrypt it — throwing prevents silent key rotation / data loss.
    if (!encryptionAvailable) {
      logWarn(
        "[RuntimeKeyStore] safeStorage encryption unavailable — " +
          "using 0600 plaintext key fallback. Payload encryption is degraded.",
      );
      const existingPlain = await this.tryLoadPlaintext();
      if (existingPlain) return existingPlain;

      const existingEncrypted = await this.tryLoad();
      if (existingEncrypted) {
        throw new Error("RUNTIME_KEYSTORE_ENCRYPTION_UNAVAILABLE");
      }

      await mkdir(this.secretsDir, { recursive: true, mode: 0o700 });
      return this.createPlaintextExclusive();
    }

    const existing = await this.tryLoad();
    if (existing) return existing;

    await mkdir(this.secretsDir, { recursive: true, mode: 0o700 });
    return this.createExclusive();
  }

  private async tryLoad(): Promise<Buffer | null> {
    const filePath = join(this.secretsDir, KEY_FILE);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return null;
      throw new Error("RUNTIME_KEYSTORE_READ_FAILED");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error("RUNTIME_KEYSTORE_CORRUPT");
    }
    if (!isEncryptedPayload(payload)) {
      throw new Error("RUNTIME_KEYSTORE_CORRUPT");
    }

    try {
      const decrypted = this.storage.decryptString(
        Buffer.from(payload.ciphertext, "base64"),
      );
      const key = Buffer.from(decrypted, "base64");
      if (key.length !== KEY_BYTES) {
        throw new Error("RUNTIME_KEYSTORE_CORRUPT");
      }
      return key;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "RUNTIME_KEYSTORE_CORRUPT"
      ) {
        throw error;
      }
      // Decryption failed (e.g. Keychain cleared, app identity changed).
      // Remove the orphaned file so loadOrCreate can generate a fresh key.
      log("[RuntimeKeyStore] Decryption failed, removing orphaned key file");
      try {
        await rm(filePath, { force: true });
      } catch {
        /* best effort */
      }
      return null;
    }
  }

  private async createExclusive(): Promise<Buffer> {
    const key = randomBytes(KEY_BYTES);
    const payload: EncryptedKey = {
      version: 1,
      ciphertext: this.storage
        .encryptString(key.toString("base64"))
        .toString("base64"),
    };
    const filePath = join(this.secretsDir, KEY_FILE);
    const tmpPath = `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;

    try {
      await writeFile(tmpPath, `${JSON.stringify(payload)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await chmod(tmpPath, 0o600);
      try {
        await link(tmpPath, filePath);
        await chmod(filePath, 0o600);
        return key;
      } catch (error) {
        if (!isNodeError(error, "EEXIST")) throw error;
        const winner = await this.tryLoad();
        if (!winner) throw new Error("RUNTIME_KEYSTORE_CREATE_RACE");
        return winner;
      }
    } finally {
      await rm(tmpPath, { force: true }).catch(() => undefined);
    }
  }
  /** Load a plaintext-fallback key file, or null when absent. */
  private async tryLoadPlaintext(): Promise<Buffer | null> {
    const filePath = join(this.secretsDir, KEY_FILE);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return null;
      throw new Error("RUNTIME_KEYSTORE_READ_FAILED");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error("RUNTIME_KEYSTORE_CORRUPT");
    }
    if (!isPlaintextPayload(payload)) {
      return null; // encrypted format — caller decides
    }

    const key = Buffer.from(payload.key, "base64");
    if (key.length !== KEY_BYTES) {
      throw new Error("RUNTIME_KEYSTORE_CORRUPT");
    }
    return key;
  }

  /** Create the plaintext-fallback key file with an exclusive link. */
  private async createPlaintextExclusive(): Promise<Buffer> {
    const key = randomBytes(KEY_BYTES);
    const payload: PlaintextKey = {
      version: 1,
      format: "plaintext",
      key: key.toString("base64"),
    };
    const filePath = join(this.secretsDir, KEY_FILE);
    const tmpPath = `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;

    try {
      await writeFile(tmpPath, `${JSON.stringify(payload)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await chmod(tmpPath, 0o600);
      try {
        await link(tmpPath, filePath);
        await chmod(filePath, 0o600);
        return key;
      } catch (error) {
        if (!isNodeError(error, "EEXIST")) throw error;
        const winner = await this.tryLoadPlaintext();
        if (!winner) throw new Error("RUNTIME_KEYSTORE_CREATE_RACE");
        return winner;
      }
    } finally {
      await rm(tmpPath, { force: true }).catch(() => undefined);
    }
  }
}
function isEncryptedPayload(value: unknown): value is EncryptedKey {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1 && typeof record.ciphertext === "string";
}

function isPlaintextPayload(value: unknown): value is PlaintextKey {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    record.format === "plaintext" &&
    typeof record.key === "string"
  );
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
