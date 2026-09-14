import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalVaultStore } from "../src/main/vault/local-store";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    copyFile: vi.fn(async () => {
      const error = new Error(
        "no space left on device",
      ) as NodeJS.ErrnoException;
      error.code = "ENOSPC";
      throw error;
    }),
  };
});

describe("LocalVaultStore disk-full handling", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("maps ENOSPC to a dedicated code and leaves no file behind", async () => {
    const root = await mkdtemp(join(tmpdir(), "deskwand-vault-enospc-"));
    roots.push(root);
    const store = new LocalVaultStore(join(root, "vault"));
    await store.ensureDirectory();
    const source = join(root, "source.txt");
    await writeFile(source, "source");

    await expect(store.importFile(source)).rejects.toThrow(
      "VAULT_LOCAL_DISK_FULL",
    );
    expect(existsSync(store.filePath("source.txt"))).toBe(false);
  });
});
