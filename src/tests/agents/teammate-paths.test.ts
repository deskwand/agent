import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getTeammateMemoryRoot,
  getTeammateRoot,
  getTeammateWorkspace,
  isManagedWorkspace,
} from "../../main/agents/teammate-paths";

describe("teammate-paths", () => {
  it("builds root/workspace/memory under userData/teammates", () => {
    expect(getTeammateRoot("/u", "a1")).toBe(
      path.join("/u", "teammates", "a1"),
    );
    expect(getTeammateWorkspace("/u", "a1")).toBe(
      path.join("/u", "teammates", "a1", "workspace"),
    );
    expect(getTeammateMemoryRoot("/u", "a1")).toBe(
      path.join("/u", "teammates", "a1", "memory"),
    );
  });

  it.each(["", ".", "..", "a/b", "a\\b", "../x"])(
    "rejects unsafe id %j",
    (id) => {
      expect(() => getTeammateRoot("/u", id)).toThrow();
    },
  );

  it("recognizes only the exact managed workspace", () => {
    const ws = getTeammateWorkspace("/u", "a1");
    expect(isManagedWorkspace("/u", { id: "a1", cwd: ws })).toBe(true);
    expect(isManagedWorkspace("/u", { id: "a1", cwd: ws + path.sep })).toBe(
      true,
    );
    expect(
      isManagedWorkspace("/u", { id: "a1", cwd: path.join(ws, "sub") }),
    ).toBe(false);
    expect(
      isManagedWorkspace("/u", {
        id: "a1",
        cwd: path.join("/u", "teammates", "a1x", "workspace"),
      }),
    ).toBe(false);
    expect(isManagedWorkspace("/u", { id: "a2", cwd: ws })).toBe(false);
    expect(isManagedWorkspace("/u", { id: "a1", cwd: "/repo" })).toBe(false);
  });
});
