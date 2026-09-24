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

  const nested: RemoteVaultIndex = {
    version: 1,
    files: {
      "foo/references/笔记.md": {
        objectId: "obj-1",
        hash: "h",
        size: 1,
        mtime: 1,
      },
    },
  };

  it("accepts nested paths only for skills", () => {
    const payload = encodeRemoteIndex(nested, mek);
    expect(decodeRemoteIndex(payload, mek, "skills")).toEqual(nested);
    expect(() => decodeRemoteIndex(payload, mek)).toThrow("BAD_VAULT_INDEX");
  });

  it.each([
    "../escape",
    "foo/../escape",
    "/absolute",
    "foo//bar",
    "foo/",
    "foo\\bar",
  ])("rejects unsafe skills index path %s", (name) => {
    const payload = encodeRemoteIndex(
      {
        version: 1,
        files: { [name]: nested.files["foo/references/笔记.md"] },
      },
      mek,
    );
    expect(() => decodeRemoteIndex(payload, mek, "skills")).toThrow(
      "BAD_VAULT_INDEX",
    );
  });
});
