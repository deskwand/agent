import { describe, expect, it, vi } from "vitest";
import { browseRemote } from "../../main/sandbox/ssh-browser";

function sftpWith(entries: Array<{ name: string; dir: boolean }>) {
  return {
    realpath: vi.fn(async () => "/home/zjc"),
    readdir: vi.fn(async () =>
      entries.map((e) => ({
        filename: e.name,
        attrs: { isDirectory: () => e.dir, size: e.dir ? 0 : 5 },
      })),
    ),
  };
}

describe("browseRemote", () => {
  it("省略 path 时落在 $HOME，返回 parent", async () => {
    const sftp = sftpWith([
      { name: "proj", dir: true },
      { name: "a.txt", dir: false },
    ]);
    const result = await browseRemote({ sftp: async () => sftp });
    expect(result.path).toBe("/home/zjc");
    expect(result.parent).toBe("/home");
    expect(result.entries).toEqual([
      { name: "proj", isDir: true, size: 0 },
      { name: "a.txt", isDir: false, size: 5 },
    ]);
  });

  it("允许浏览 defaultPath 之外的绝对路径", async () => {
    const sftp = sftpWith([{ name: "app", dir: true }]);
    const result = await browseRemote({ sftp: async () => sftp }, "/srv");
    expect(result.path).toBe("/srv");
    expect(result.parent).toBe("/");
  });

  it("拒绝 .. 与相对路径", async () => {
    const sftp = sftpWith([]);
    const deps = { sftp: async () => sftp };
    await expect(browseRemote(deps, "/srv/../etc")).rejects.toThrow();
    await expect(browseRemote(deps, "srv")).rejects.toThrow();
  });
});
