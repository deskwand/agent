import { describe, expect, it } from "vitest";
import { remoteJoinInsideRoot } from "../../main/tools/remote-path";
import { PathResolver } from "../../main/sandbox/path-resolver";

describe("remoteJoinInsideRoot", () => {
  it("相对路径拼到根上", () => {
    expect(remoteJoinInsideRoot("/srv/app", "src/a.ts")).toBe(
      "/srv/app/src/a.ts",
    );
  });

  it("绝对路径必须落在根内", () => {
    expect(remoteJoinInsideRoot("/srv/app", "/srv/app/b.ts")).toBe(
      "/srv/app/b.ts",
    );
    expect(() => remoteJoinInsideRoot("/srv/app", "/etc/passwd")).toThrow(
      /outside/,
    );
  });

  it("拒绝 .. 穿越", () => {
    expect(() => remoteJoinInsideRoot("/srv/app", "../x")).toThrow(/outside/);
  });
});

describe("PathResolver 远程挂载", () => {
  it("把虚拟路径解析回 ssh:// 工作区路径", () => {
    const resolver = new PathResolver();
    resolver.registerSession("s1", [
      { virtual: "/mnt/workspace", real: "ssh://h1/srv/app" },
    ]);
    expect(resolver.resolve("s1", "/mnt/workspace/src/a.ts")).toBe(
      "ssh://h1/srv/app/src/a.ts",
    );
  });

  it("越出工作区的虚拟路径返回 null", () => {
    const resolver = new PathResolver();
    resolver.registerSession("s1", [
      { virtual: "/mnt/workspace", real: "ssh://h1/srv/app" },
    ]);
    expect(resolver.resolve("s1", "/etc/passwd")).toBeNull();
  });
});
