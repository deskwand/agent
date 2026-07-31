/**
 * Channel Secret Store
 *
 * Synchronous secure storage for channel instance credentials using Electron
 * safeStorage. Secrets are persisted under userData/channel-secrets/ with
 * atomic 0600 writes and no plaintext fallback.
 *
 * - write(instanceId, field, value): encrypts and persists a single field
 * - read(instanceId, field): returns decrypted value (requires safeStorage)
 * - deleteInstance(instanceId): removes all secrets for an instance
 * - maskSentinel(instanceId, field): returns the opaque reference string
 *
 * RemoteConfigStore persists only these opaque sentinels for SECRET_FIELDS.
 * listChannelInstances(false) hydrates secrets for adapter construction;
 * listChannelInstances(true) masks them for the renderer.
 */

import { safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { log } from "../utils/logger";

/** Sentinel prefix identifying a stored secret reference. */
export const SECRET_SENTINEL_PREFIX = "sec:";

export interface ChannelSecureStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface StoredSecret {
  version: 1;
  ciphertext: string;
}

export class ChannelSecretStore {
  private readonly storage: ChannelSecureStorage;

  constructor(
    private readonly rootDirectory: string,
    storage: ChannelSecureStorage = safeStorage,
  ) {
    this.storage = storage;
  }

  /**
   * Returns true when the OS-level encryption is available and the
   * secret store can read and write securely.
   */
  isAvailable(): boolean {
    return this.storage.isEncryptionAvailable();
  }

  /**
   * Write an encrypted secret field. Creates the directory with 0700 on first
   * write. Throws if safeStorage encryption is unavailable.
   */
  write(instanceId: string, field: string, value: string): void {
    if (!this.storage.isEncryptionAvailable()) {
      throw new Error("CHANNEL_SECRET_STORE_UNAVAILABLE");
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(instanceId)) {
      throw new Error("CHANNEL_SECRET_INVALID_INSTANCE_ID");
    }
    if (!/^[A-Za-z0-9_]{1,64}$/.test(field)) {
      throw new Error("CHANNEL_SECRET_INVALID_FIELD");
    }

    mkdirSync(join(this.rootDirectory, instanceId), {
      recursive: true,
      mode: 0o700,
    });

    const encrypted: StoredSecret = {
      version: 1,
      ciphertext: this.storage.encryptString(value).toString("base64"),
    };

    const file = this.fileFor(instanceId, field);
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(tmp, `${JSON.stringify(encrypted)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      chmodSync(tmp, 0o600);
      renameSync(tmp, file);
      chmodSync(file, 0o600);
    } finally {
      rmSync(tmp, { force: true });
    }
  }

  /**
   * Read and decrypt a stored secret. Returns null when the secret does not
   * exist or when safeStorage is unavailable — the caller must handle missing
   * secrets gracefully and never log the error details.
   */
  read(instanceId: string, field: string): string | null {
    if (!this.storage.isEncryptionAvailable()) {
      log("[ChannelSecretStore] safeStorage unavailable, returning null");
      return null;
    }
    const file = this.fileFor(instanceId, field);
    if (!existsSync(file)) return null;

    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
      if (!isStoredSecret(raw)) return null;
      return this.storage.decryptString(Buffer.from(raw.ciphertext, "base64"));
    } catch (error) {
      if (isMissingFile(error)) return null;
      // Decryption failed (e.g. Keychain cleared, app identity changed).
      // The stored ciphertext is irrecoverable — remove the orphaned file.
      log("[ChannelSecretStore] Decryption failed, removing orphaned secret");
      try {
        rmSync(file, { force: true });
      } catch {
        /* best effort */
      }
      return null;
    }
  }

  /**
   * Remove all stored secrets for a channel instance. Safe to call even
   * when no secrets exist.
   */
  deleteInstance(instanceId: string): void {
    const instanceDir = join(this.rootDirectory, instanceId);
    if (!existsSync(instanceDir)) return;
    try {
      for (const entry of readdirSync(instanceDir)) {
        unlinkSync(join(instanceDir, entry));
      }
      rmdirSync(instanceDir);
    } catch {
      // Best-effort cleanup
    }
  }

  /**
   * Generate an opaque sentinel that RemoteConfigStore stores in the
   * config instead of the plaintext secret value.
   */
  maskSentinel(instanceId: string, field: string): string {
    return `${SECRET_SENTINEL_PREFIX}${instanceId}:${field}`;
  }

  /**
   * Returns true when the string is a secret sentinel that references
   * the channel secret store.
   */
  static isSentinel(value: string): boolean {
    return value.startsWith(SECRET_SENTINEL_PREFIX);
  }

  /**
   * Parse a sentinel string back into instanceId + field components.
   * Returns undefined when the input is not a valid sentinel.
   */
  static parseSentinel(
    sentinel: string,
  ): { instanceId: string; field: string } | undefined {
    if (!sentinel.startsWith(SECRET_SENTINEL_PREFIX)) return undefined;
    const rest = sentinel.slice(SECRET_SENTINEL_PREFIX.length);
    const colonIdx = rest.indexOf(":");
    if (colonIdx < 1) return undefined;
    return {
      instanceId: rest.slice(0, colonIdx),
      field: rest.slice(colonIdx + 1),
    };
  }

  /**
   * Hydrate a secret value from the store given an opaque sentinel.
   * Returns the original value if it is not a sentinel (already plaintext
   * — pre-migration or non-secret field).
   * Returns empty string when the secret cannot be read, so the app can
   * start without blocking; channel adapters will fail gracefully.
   */
  hydrate(sentinelOrValue: string): string {
    const parsed = ChannelSecretStore.parseSentinel(sentinelOrValue);
    if (!parsed) return sentinelOrValue;
    const decrypted = this.read(parsed.instanceId, parsed.field);
    if (decrypted === null) {
      log(`[ChannelSecretStore] Secret not available: ${parsed.instanceId}/${parsed.field}`);
      return "";
    }
    return decrypted;
  }

  private fileFor(instanceId: string, field: string): string {
    return join(
      this.rootDirectory,
      instanceId,
      `${field}.json`,
    );
  }
}

function isStoredSecret(value: unknown): value is StoredSecret {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1 && typeof record.ciphertext === "string";
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
