import { safeStorage, app } from "electron";
import { join } from "node:path";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { deriveMek } from "./crypto";
import { decodeRemoteIndex } from "./vault-index";
import { validateRecoveryCode } from "./recovery";

const FILE = "vault-mek.bin";

function filePath(): string {
  return join(app.getPath("userData"), "vault", FILE);
}

export function hasStoredMek(): boolean {
  return safeStorage.isEncryptionAvailable() && existsSync(filePath());
}

export function loadMek(): Buffer | null {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const p = filePath();
  if (!existsSync(p)) return null;
  const ct = readFileSync(p);
  return Buffer.from(safeStorage.decryptString(ct), "base64");
}

export function storeMek(mek: Buffer): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("VAULT_KEYCHAIN_UNAVAILABLE");
  }
  const p = filePath();
  mkdirSync(join(p, ".."), { recursive: true, mode: 0o700 });
  const enc = safeStorage.encryptString(mek.toString("base64"));
  const tempPath = `${p}.tmp-${process.pid}-${Date.now()}`;
  const fd = openSync(tempPath, "w", 0o600);
  let closed = false;
  let renamed = false;
  try {
    writeSync(fd, enc);
    fsyncSync(fd);
    closeSync(fd);
    closed = true;
    renameSync(tempPath, p);
    renamed = true;
  } finally {
    if (!renamed) {
      if (!closed) closeSync(fd);
      rmSync(tempPath, { force: true });
    }
  }

  try {
    const directoryFd = openSync(join(p, ".."), "r");
    try {
      fsyncSync(directoryFd);
    } finally {
      closeSync(directoryFd);
    }
  } catch (error: unknown) {
    const code = error as NodeJS.ErrnoException;
    if (
      code.code !== "EINVAL" &&
      code.code !== "ENOTSUP" &&
      code.code !== "EPERM"
    ) {
      throw error;
    }
  }
}

/** 从安全存储加载 MEK；不存在则用恢复码派生并持久化。 */
export function loadOrCreateMek(recoveryCode: string | null): Buffer {
  const mek = loadMek();
  if (mek) return mek;
  if (!recoveryCode) throw new Error("VAULT_UNINITIALIZED");
  const derived = deriveMek(recoveryCode);
  storeMek(derived);
  return derived;
}

export function initializeNewMek(recoveryCode: string): void {
  if (!validateRecoveryCode(recoveryCode)) {
    throw new Error("VAULT_INVALID_RECOVERY_CODE");
  }
  if (loadMek()) throw new Error("VAULT_ALREADY_INITIALIZED");
  storeMek(deriveMek(recoveryCode));
}

export function replaceMek(recoveryCode: string): void {
  if (!validateRecoveryCode(recoveryCode)) {
    throw new Error("VAULT_INVALID_RECOVERY_CODE");
  }
  storeMek(deriveMek(recoveryCode));
}

export function verifyAndStoreMek(
  recoveryCode: string,
  encryptedRemoteIndex: Buffer | null,
): void {
  if (!validateRecoveryCode(recoveryCode)) {
    throw new Error("VAULT_INVALID_RECOVERY_CODE");
  }
  const candidate = deriveMek(recoveryCode);
  if (encryptedRemoteIndex) {
    try {
      decodeRemoteIndex(encryptedRemoteIndex, candidate);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message === "VAULT_INDEX_AUTH_FAILED"
      ) {
        throw new Error("VAULT_RECOVERY_MISMATCH");
      }
      throw error;
    }
  }
  const existing = loadMek();
  if (existing) {
    if (!existing.equals(candidate)) {
      throw new Error("VAULT_ALREADY_INITIALIZED");
    }
    return;
  }
  storeMek(candidate);
}
