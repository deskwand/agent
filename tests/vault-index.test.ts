import { describe, expect, it } from "vitest";
import { deriveMek } from "../src/main/vault/crypto";
import {
  decodeRemoteIndex,
  encodeRemoteIndex,
  fromRemoteIndex,
  toRemoteIndex,
  type RemoteVaultIndex,
} from "../src/main/vault/vault-index";
import type { LocalVaultIndex } from "../src/main/vault/local-store";

const mek = deriveMek("123456789ABCDEFGHJKLMNPQRSTUVWXYZ");
const localIndex: LocalVaultIndex = {
  version: 1,
  files: {
    "readme.md": {
      objectId: "obj-1",
      hash: "hash-1",
      size: 12,
      mtime: 2,
      syncStatus: "failed",
    },
    "new.txt": {
      objectId: null,
      hash: "hash-2",
      size: 3,
      mtime: 4,
      syncStatus: "pending",
    },
  },
  pendingDeletes: ["old-obj"],
};

describe("Vault remote index codec", () => {
  it("converts only backed-up files to a remote snapshot", () => {
    expect(toRemoteIndex(localIndex)).toEqual({
      version: 1,
      files: {
        "readme.md": {
          objectId: "obj-1",
          hash: "hash-1",
          size: 12,
          mtime: 2,
        },
      },
    });
  });

  it("round-trips an encrypted remote snapshot", () => {
    const remote: RemoteVaultIndex = toRemoteIndex(localIndex);
    expect(decodeRemoteIndex(encodeRemoteIndex(remote, mek), mek)).toEqual(
      remote,
    );
  });

  it("does not decrypt with a different MEK", () => {
    const payload = encodeRemoteIndex(toRemoteIndex(localIndex), mek);
    expect(() =>
      decodeRemoteIndex(payload, deriveMek("different-recovery-code")),
    ).toThrow();
  });

  it("restores a remote snapshot as synced local entries", () => {
    expect(fromRemoteIndex(toRemoteIndex(localIndex))).toEqual({
      version: 1,
      files: {
        "readme.md": {
          objectId: "obj-1",
          hash: "hash-1",
          size: 12,
          mtime: 2,
          syncStatus: "synced",
          objectHash: "hash-1",
        },
      },
      pendingDeletes: [],
    });
  });
});
