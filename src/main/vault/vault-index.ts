import { decryptAes, encryptAes, generateNonce } from "./crypto";
import type { LocalVaultEntry, LocalVaultIndex } from "./local-store";

const NONCE_SIZE = 12;

export interface RemoteVaultEntry {
  objectId: string;
  hash: string;
  size: number;
  mtime: number;
}

export interface RemoteVaultIndex {
  version: 1;
  files: Record<string, RemoteVaultEntry>;
}

export function toRemoteIndex(index: LocalVaultIndex): RemoteVaultIndex {
  const files: Record<string, RemoteVaultEntry> = {};
  for (const name of Object.keys(index.files).sort()) {
    const entry = index.files[name];
    if (!entry.objectId) continue;
    files[name] = {
      objectId: entry.objectId,
      hash: entry.hash,
      size: entry.size,
      mtime: entry.mtime,
    };
  }
  return { version: 1, files };
}

export function fromRemoteIndex(remote: RemoteVaultIndex): LocalVaultIndex {
  const files: Record<string, LocalVaultEntry> = {};
  for (const name of Object.keys(remote.files).sort()) {
    const entry = remote.files[name];
    files[name] = {
      objectId: entry.objectId,
      hash: entry.hash,
      size: entry.size,
      mtime: entry.mtime,
      syncStatus: "synced",
      objectHash: entry.hash,
    };
  }
  return { version: 1, files, pendingDeletes: [] };
}

export function encodeRemoteIndex(
  index: RemoteVaultIndex,
  mek: Buffer,
): Buffer {
  const nonce = generateNonce();
  const plaintext = Buffer.from(JSON.stringify(index), "utf8");
  return Buffer.concat([nonce, encryptAes(plaintext, mek, nonce)]);
}

export function decodeRemoteIndex(
  payload: Buffer,
  mek: Buffer,
): RemoteVaultIndex {
  if (payload.length < NONCE_SIZE + 16) throw new Error("BAD_VAULT_INDEX");
  const nonce = payload.subarray(0, NONCE_SIZE);
  let plaintext: Buffer;
  try {
    plaintext = decryptAes(payload.subarray(NONCE_SIZE), mek, nonce);
  } catch {
    throw new Error("VAULT_INDEX_AUTH_FAILED");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new Error("BAD_VAULT_INDEX");
  }
  if (!isRemoteVaultIndex(parsed)) throw new Error("BAD_VAULT_INDEX");
  return parsed;
}

function isRemoteVaultIndex(value: unknown): value is RemoteVaultIndex {
  if (!value || typeof value !== "object") return false;
  const candidate = value as {
    version?: unknown;
    files?: unknown;
  };
  if (
    candidate.version !== 1 ||
    !candidate.files ||
    typeof candidate.files !== "object"
  ) {
    return false;
  }
  return Object.entries(candidate.files).every(([name, entry]) => {
    if (
      !name ||
      name === ".vault-index.json" ||
      name.includes("/") ||
      name.includes("\\")
    ) {
      return false;
    }
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Partial<RemoteVaultEntry>;
    return (
      typeof item.objectId === "string" &&
      item.objectId.length > 0 &&
      typeof item.hash === "string" &&
      typeof item.size === "number" &&
      Number.isFinite(item.size) &&
      item.size >= 0 &&
      typeof item.mtime === "number" &&
      Number.isFinite(item.mtime)
    );
  });
}
