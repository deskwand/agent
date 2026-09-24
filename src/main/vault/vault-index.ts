import { decryptAes, encryptAes, generateNonce } from "./crypto";
import {
  isVaultModule,
  type LocalVaultEntry,
  type LocalVaultIndex,
} from "./local-store";

const NONCE_SIZE = 12;

export interface RemoteVaultEntry {
  objectId: string;
  hash: string;
  size: number;
  mtime: number;
}

export interface RemoteVaultIndex {
  version: 2;
  files: Record<string, RemoteVaultEntry>;
}

export function toRemoteIndex(index: LocalVaultIndex): RemoteVaultIndex {
  const files: Record<string, RemoteVaultEntry> = {};
  for (const name of Object.keys(index.files).sort()) {
    const entry = index.files[name];
    // 远端条目必须自带内容 hash：本地上传成功后两者一定同时就位，
    // 而 hash 为空（尚未上传）的条目本来就不该出现在远端索引里。
    if (!entry.objectId || !entry.hash) continue;
    files[name] = {
      objectId: entry.objectId,
      hash: entry.hash,
      size: entry.size,
      mtime: entry.mtime,
    };
  }
  return { version: 2, files };
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
  return { version: 2, files, pendingDeletes: [] };
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

/**
 * 远端索引键的路径规则：根相对路径，首段必须是模块，其余段沿用本地扫描器的
 * 对外契约（拒穿越、拒 Win32 会归一化的尾点/尾空格、拒保留设备名）。
 * 两侧实现分布在不同模块，都有测试钉住。
 */
function isRejectedRemoteSegment(segment: string): boolean {
  if (!segment || segment === "." || segment === "..") return true;
  if (/[. ]$/.test(segment)) return true;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(segment);
}

function isValidVaultIndexPath(name: string): boolean {
  if (!name || name.includes("\\") || name.includes("\0")) return false;
  if (name.startsWith("/") || name.endsWith("/")) return false;
  const [moduleName, ...rest] = name.split("/");
  if (!isVaultModule(moduleName) || rest.length === 0) return false;
  return rest.every((segment) => !isRejectedRemoteSegment(segment));
}

function isRemoteVaultIndex(value: unknown): value is RemoteVaultIndex {
  if (!value || typeof value !== "object") return false;
  const candidate = value as {
    version?: unknown;
    files?: unknown;
  };
  if (
    candidate.version !== 2 ||
    !candidate.files ||
    typeof candidate.files !== "object"
  ) {
    return false;
  }
  return Object.entries(candidate.files).every(([name, entry]) => {
    if (!isValidVaultIndexPath(name)) return false;
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
