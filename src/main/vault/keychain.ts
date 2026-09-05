import { safeStorage, app } from "electron";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deriveMek } from "./crypto";

const FILE = "vault-mek.bin";

function filePath(): string {
  return join(app.getPath("userData"), "vault", FILE);
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
  writeFileSync(p, enc, { mode: 0o600 });
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
