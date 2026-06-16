import { describe, it, expect } from "vitest";
import {
  normalizePathForContainment,
  isPathWithinRoot,
} from "../main/tools/path-containment";

describe("normalizePathForContainment", () => {
  it("normalizes backslashes to forward slashes", () => {
    expect(normalizePathForContainment("C:\\Users\\foo")).toBe("C:/Users/foo");
  });

  it("strips trailing slashes", () => {
    expect(normalizePathForContainment("/home/user/")).toBe("/home/user");
  });

  it('preserves root slash when input is just "/"', () => {
    expect(normalizePathForContainment("/")).toBe("/");
  });

  it("preserves root slash when input is multiple slashes", () => {
    expect(normalizePathForContainment("//")).toBe("/");
  });

  it("preserves root slash for backslash", () => {
    expect(normalizePathForContainment("\\")).toBe("/");
  });

  it("returns empty for empty string", () => {
    expect(normalizePathForContainment("")).toBe("");
  });

  it("applies case insensitive normalization", () => {
    expect(normalizePathForContainment("/Home/User", true)).toBe("/home/user");
  });
});

describe("isPathWithinRoot", () => {
  it("returns true for exact root match", () => {
    expect(isPathWithinRoot("/workspace", "/workspace")).toBe(true);
  });

  it("returns true for child path", () => {
    expect(isPathWithinRoot("/workspace/src/file.ts", "/workspace")).toBe(true);
  });

  it("returns false for sibling path with shared prefix", () => {
    expect(isPathWithinRoot("/workspace-other/file.ts", "/workspace")).toBe(
      false,
    );
  });

  it("returns false for parent path", () => {
    expect(isPathWithinRoot("/work", "/workspace")).toBe(false);
  });

  it("returns false for empty target", () => {
    expect(isPathWithinRoot("", "/workspace")).toBe(false);
  });

  it("returns false for empty root", () => {
    expect(isPathWithinRoot("/workspace", "")).toBe(false);
  });

  it("handles root as /", () => {
    expect(isPathWithinRoot("/anything", "/")).toBe(true);
  });

  it("handles root as / with exact match", () => {
    expect(isPathWithinRoot("/", "/")).toBe(true);
  });

  it("case insensitive mode works for Windows paths", () => {
    expect(
      isPathWithinRoot("C:\\Users\\FOO\\file.txt", "c:\\users\\foo", true),
    ).toBe(true);
  });
});
