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
  version: 2,
  files: {
    "files/readme.md": {
      objectId: "obj-1",
      hash: "hash-1",
      size: 12,
      mtime: 2,
      syncStatus: "failed",
      objectHash: "hash-1",
    },
    "files/new.txt": {
      objectId: null,
      hash: null,
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
      version: 2,
      files: {
        "files/readme.md": {
          objectId: "obj-1",
          hash: "hash-1",
          size: 12,
          mtime: 2,
        },
      },
    });
  });

  it("skips entries whose content hash is not known yet", () => {
    const index: LocalVaultIndex = {
      version: 2,
      files: {
        "files/pending.md": {
          objectId: "obj-9",
          hash: null,
          size: 1,
          mtime: 1,
          syncStatus: "pending",
        },
      },
      pendingDeletes: [],
    };
    expect(toRemoteIndex(index).files).toEqual({});
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
      version: 2,
      files: {
        "files/readme.md": {
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
    version: 2,
    files: {
      "skills/claude-api/references/笔记.md": {
        objectId: "obj-1",
        hash: "h",
        size: 1,
        mtime: 1,
      },
    },
  };

  it("accepts module-prefixed nested paths", () => {
    const payload = encodeRemoteIndex(nested, mek);
    expect(decodeRemoteIndex(payload, mek)).toEqual(nested);
  });

  it.each([
    "../escape",
    "files/../escape",
    "/absolute",
    "files//bar",
    "files/",
    "files\\bar",
    "readme.md",
    "notes/readme.md",
    "files/notes.",
    "files/con.md",
  ])("rejects unsafe index path %s", (name) => {
    const payload = encodeRemoteIndex(
      {
        version: 2,
        files: {
          [name]: nested.files["skills/claude-api/references/笔记.md"],
        },
      },
      mek,
    );
    expect(() => decodeRemoteIndex(payload, mek)).toThrow("BAD_VAULT_INDEX");
  });
});
