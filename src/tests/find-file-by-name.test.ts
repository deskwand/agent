import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { findFileByName } from "../main/utils/find-file-by-name";

/**
 * 与 showItemInFolder 里原来那段内联 BFS 行为一致：逐层遍历、首个命中即返回。
 * 多根时"根顺序优先、其次层数"。
 */
describe("findFileByName", () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "find-by-name-"));
    // root/a/deep/target.txt   （深）
    fs.mkdirSync(path.join(root, "a", "deep"), { recursive: true });
    fs.writeFileSync(path.join(root, "a", "deep", "target.txt"), "deep");
    // root/target.txt          （浅，应优先命中）
    fs.writeFileSync(path.join(root, "target.txt"), "shallow");
    // root/b/only-here.txt
    fs.mkdirSync(path.join(root, "b"), { recursive: true });
    fs.writeFileSync(path.join(root, "b", "only-here.txt"), "b");
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("finds a file in a subdirectory", () => {
    expect(findFileByName("only-here.txt", [root])).toBe(
      path.join(root, "b", "only-here.txt"),
    );
  });

  it("prefers the shallowest match when a name appears twice", () => {
    expect(findFileByName("target.txt", [root])).toBe(
      path.join(root, "target.txt"),
    );
  });

  it("returns null when nothing matches", () => {
    expect(findFileByName("nope.txt", [root])).toBeNull();
  });

  it("returns null for an empty name", () => {
    expect(findFileByName("", [root])).toBeNull();
  });

  it("skips roots that do not exist", () => {
    expect(
      findFileByName("only-here.txt", [path.join(root, "missing"), root]),
    ).toBe(path.join(root, "b", "only-here.txt"));
  });

  it("gives up once maxDirs is exhausted", () => {
    // maxDirs=1 只允许访问根目录本身，进不到 b/ 里
    expect(findFileByName("only-here.txt", [root], 1)).toBeNull();
  });
});
