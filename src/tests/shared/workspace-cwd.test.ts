import { describe, expect, it } from "vitest";
import {
  formatWorkspaceCwd,
  parseWorkspaceCwd,
  toSshWorkspace,
} from "../../shared/workspace-cwd";

describe("parseWorkspaceCwd", () => {
  it("把普通路径当本地", () => {
    expect(parseWorkspaceCwd("/Users/a/proj")).toEqual({
      kind: "local",
      path: "/Users/a/proj",
    });
  });

  it("解析远程工作区并归一化路径", () => {
    expect(parseWorkspaceCwd("ssh://h1/home/zjc//proj/")).toEqual({
      kind: "ssh",
      hostId: "h1",
      path: "/home/zjc/proj",
    });
  });

  it("拒绝缺路径、含 ..、hostId 带斜杠的字符串", () => {
    expect(() => parseWorkspaceCwd("ssh://h1")).toThrow();
    expect(() => parseWorkspaceCwd("ssh://h1/../etc")).toThrow();
    expect(() => parseWorkspaceCwd("ssh://")).toThrow();
  });
});

describe("toSshWorkspace / formatWorkspaceCwd", () => {
  it("往返一致", () => {
    const cwd = toSshWorkspace("h1", "/srv/app");
    expect(cwd).toBe("ssh://h1/srv/app");
    expect(parseWorkspaceCwd(cwd)).toEqual({
      kind: "ssh",
      hostId: "h1",
      path: "/srv/app",
    });
  });

  it("拒绝相对路径与空 hostId", () => {
    expect(() => toSshWorkspace("", "/a")).toThrow();
    expect(() => toSshWorkspace("h1", "relative")).toThrow();
  });

  it("显示优先用 hostLabel，缺失时回退 hostId", () => {
    expect(formatWorkspaceCwd("ssh://h1/srv/app", "z")).toBe("z:/srv/app");
    expect(formatWorkspaceCwd("ssh://h1/srv/app")).toBe("h1:/srv/app");
    expect(formatWorkspaceCwd("/Users/a/proj")).toBe("/Users/a/proj");
  });
});
