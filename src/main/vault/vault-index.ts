import { decryptAes, encryptAes, generateNonce } from "./crypto";
import type { LocalVaultEntry, LocalVaultIndex } from "./local-store";
import type { VaultIndexScope } from "./cloud-client";

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
  scope: VaultIndexScope = "files",
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
  if (!isRemoteVaultIndex(parsed, scope)) throw new Error("BAD_VAULT_INDEX");
  return parsed;
}

/**
 * skills 索引键的路径规则。与 `local-store.isValidScopeRelativePath` 保持同一
 * 对外契约：拒穿越、拒 Win32 会归一化的名字（尾点/尾空格）、拒保留设备名。
 * 两份实现分布在不同模块（跨模块共享要新增依赖边），两侧都有测试钉住。
 */
function isRejectedRemoteSegment(segment: string): boolean {
  if (!segment || segment === "." || segment === "..") return true;
  if (/[. ]$/.test(segment)) return true;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(segment);
}

function isValidSkillIndexPath(name: string): boolean {
  if (!name || name.includes("\\") || name.includes("\0")) return false;
  if (name.startsWith("/") || name.endsWith("/")) return false;
  return name.split("/").every((segment) => !isRejectedRemoteSegment(segment));
}

function isRemoteVaultIndex(
  value: unknown,
  scope: VaultIndexScope,
): value is RemoteVaultIndex {
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
    if (!name || name === ".vault-index.json" || name.includes("\\")) {
      return false;
    }
    if (scope === "files") {
      if (name.includes("/")) return false;
    } else if (!isValidSkillIndexPath(name)) {
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
