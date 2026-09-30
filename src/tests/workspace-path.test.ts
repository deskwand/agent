import { describe, it, expect } from "vitest";
import {
  resolvePathAgainstWorkspace,
  toWorkspaceKey,
} from "../shared/workspace-path";

describe("resolvePathAgainstWorkspace", () => {
  it("returns empty/falsy pathValue as-is", () => {
    expect(resolvePathAgainstWorkspace("")).toBe("");
  });

  it("returns absolute POSIX path as-is", () => {
    expect(resolvePathAgainstWorkspace("/usr/local/bin", "/home/user")).toBe(
      "/usr/local/bin",
    );
  });

  it("returns Windows drive path as-is", () => {
    expect(resolvePathAgainstWorkspace("C:\\Users\\foo", "D:\\work")).toBe(
      "C:\\Users\\foo",
    );
  });

  it("resolves relative path against POSIX workspace", () => {
    expect(
      resolvePathAgainstWorkspace("src/main.ts", "/Users/haoqing/project"),
    ).toBe("/Users/haoqing/project/src/main.ts");
  });

  it("resolves relative path against Windows workspace", () => {
    expect(
      resolvePathAgainstWorkspace("src\\main.ts", "C:\\Users\\foo\\project"),
    ).toBe("C:\\Users\\foo\\project\\src\\main.ts");
  });

  it("normalizes .. segments in relative path", () => {
    expect(
      resolvePathAgainstWorkspace(
        "../other/file.ts",
        "/Users/haoqing/project/src",
      ),
    ).toBe("/Users/haoqing/project/other/file.ts");
  });

  it("normalizes . segments", () => {
    expect(
      resolvePathAgainstWorkspace("./file.ts", "/Users/haoqing/project"),
    ).toBe("/Users/haoqing/project/file.ts");
  });

  it("remaps /workspace/ prefix to workspace path", () => {
    expect(
      resolvePathAgainstWorkspace(
        "/workspace/src/index.ts",
        "/Users/haoqing/project",
      ),
    ).toBe("/Users/haoqing/project/src/index.ts");
  });

  it("remaps Windows workspace prefix to workspace path", () => {
    expect(
      resolvePathAgainstWorkspace(
        "C:\\workspace\\src\\index.ts",
        "D:\\myproject",
      ),
    ).toBe("D:\\myproject\\src\\index.ts");
  });

  it("returns relative path as-is when no workspace provided", () => {
    expect(resolvePathAgainstWorkspace("src/main.ts")).toBe("src/main.ts");
    expect(resolvePathAgainstWorkspace("src/main.ts", null)).toBe(
      "src/main.ts",
    );
  });

  it("returns /workspace/ path as-is when no workspace provided", () => {
    expect(resolvePathAgainstWorkspace("/workspace/src/main.ts")).toBe(
      "/workspace/src/main.ts",
    );
  });
});

describe("toWorkspaceKey", () => {
  it("keeps POSIX paths case-sensitive and only strips trailing slashes", () => {
    expect(toWorkspaceKey("/work/deskwand/")).toBe("/work/deskwand");
    expect(toWorkspaceKey("/work/Foo")).not.toBe(toWorkspaceKey("/work/foo"));
  });

  it("returns an empty key for empty or slash-only input", () => {
    expect(toWorkspaceKey("   ")).toBe("");
    expect(toWorkspaceKey("/")).toBe("");
  });

  it("matches the rule the sidebar used before it moved into shared code", () => {
    // 这些期望值就是迁移前 sidebar-session-groups.ts 里私有 workspaceKey 的输出。
    // 逐字保持的原因：localStorage 的 deskwand.sidebarPins /
    // deskwand.sidebarGroupExpansion 以这个字符串为键。
    const cases: Array<[string, string]> = [
      ["/work/deskwand", "/work/deskwand"],
      ["/work/deskwand/", "/work/deskwand"],
      ["  /work/padded  ", "/work/padded"],
      ["D:/work/App", "d:/work/app"],
      ["D:\\work\\app\\", "d:/work/app"],
      ["\\\\srv\\share\\App\\", "//srv/share/app"],
      // 退化输入：`D:` 被当成 Windows 路径（旧规则如此），
      // 而 shared/local-file-path.ts 的 isWindowsDrivePath 不认它 —— 所以这里
      // 特地把规则钉住，不允许改成复用那个 helper。
      ["D:", "d:"],
    ];
    for (const [input, expected] of cases) {
      expect(toWorkspaceKey(input)).toBe(expected);
    }
  });
});
