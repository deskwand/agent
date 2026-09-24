import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveMek } from "../src/main/vault/crypto";
import { VaultSkillsStore } from "../src/main/vault/skills-vault";

/**
 * 本文件单独存在：需要让「源目录 → 密库根」这一步抛 EXDEV，而 ESM 命名空间
 * 不能 spy（Cannot spy on export "rename"），只能用模块级 mock。
 *
 * 判据是「源路径不在密库根之下」—— 索引写入的 rename 源是
 * `<密库根>/.vault-index.json.tmp-…`，暂存 → 最终位置的 rename 源是
 * `<密库根>/.vault-upload-staging/<name>`，两者都在密库根下面，不会被拦。
 */
let vaultRootForMock = "";

vi.mock("node:fs/promises", async () => {
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  return {
    ...actual,
    default: actual,
    rename: async (from: string, to: string) => {
      const isSkillMove =
        vaultRootForMock !== "" && !String(from).startsWith(vaultRootForMock);
      if (isSkillMove) {
        const error = new Error(
          "EXDEV: cross-device link not permitted",
        ) as NodeJS.ErrnoException;
        error.code = "EXDEV";
        throw error;
      }
      return actual.rename(from, to);
    },
  };
});

const roots: string[] = [];

afterEach(async () => {
  vaultRootForMock = "";
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("VaultSkillsStore cross-filesystem fallback", () => {
  it("copies the whole tree when the source is on another device", async () => {
    const globalRoot = await mkdtemp(join(tmpdir(), "deskwand-xdev-skills-"));
    const vaultRoot = await mkdtemp(join(tmpdir(), "deskwand-xdev-vault-"));
    roots.push(globalRoot, vaultRoot);
    const globalSkills = join(globalRoot, "skills");
    const nested = join(globalSkills, "foo", "references");
    await mkdir(nested, { recursive: true });
    const skillMd = "# foo\n";
    const binary = Buffer.from([0, 1, 2, 253, 254, 255]);
    await writeFile(join(globalSkills, "foo", "SKILL.md"), skillMd);
    await writeFile(join(nested, "data.bin"), binary);

    vaultRootForMock = vaultRoot;
    const store = new VaultSkillsStore(vaultRoot, undefined, () =>
      deriveMek("recovery-code"),
    );

    await expect(store.upload("foo", globalSkills)).resolves.toMatchObject({
      name: "foo",
      fileCount: 2,
    });

    // 内容逐字节一致（含嵌套目录与二进制）
    const copiedMd = await readFile(join(vaultRoot, "foo", "SKILL.md"), "utf8");
    const copiedBin = await readFile(
      join(vaultRoot, "foo", "references", "data.bin"),
    );
    expect(copiedMd).toBe(skillMd);
    expect(copiedBin.equals(binary)).toBe(true);
    expect(createHash("sha256").update(copiedBin).digest("hex")).toBe(
      createHash("sha256").update(binary).digest("hex"),
    );

    // 本地原件已删
    await expect(readdir(globalSkills)).resolves.toEqual([]);
    // 暂存目录空着（由 removeStaleStaging 清理），不留半成品
    await expect(
      readdir(join(vaultRoot, ".vault-upload-staging")),
    ).resolves.toEqual([]);
  });
});
