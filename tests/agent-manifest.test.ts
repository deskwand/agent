import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  readManifest,
  addManifestEntry,
  removeManifestEntry,
  isAgentCreated,
  getAgentCreatedSkillNames,
  hashContent,
  updateManifestHash,
} from "../src/main/skills/agent-manifest";

let tmpDir = "";

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omagt-agent-manifest-test-"));
});

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("agent-manifest", () => {
  it("readManifest returns empty object when file does not exist", () => {
    const manifest = readManifest(tmpDir);
    expect(manifest).toEqual({});
  });

  it("addManifestEntry creates the file and adds an entry", () => {
    addManifestEntry(tmpDir, "my-skill", "---\nname: my-skill\n---");
    const manifest = readManifest(tmpDir);
    expect(manifest["my-skill"]).toBeDefined();
    expect(manifest["my-skill"].source).toBe("agent");
    expect(manifest["my-skill"].createdAt).toBeGreaterThan(0);
    expect(manifest["my-skill"].hash).toBe(hashContent("---\nname: my-skill\n---"));
  });

  it("isAgentCreated returns true for agent-created skills", () => {
    addManifestEntry(tmpDir, "agent-skill", "content");
    expect(isAgentCreated(tmpDir, "agent-skill")).toBe(true);
  });

  it("isAgentCreated returns false for unknown skills", () => {
    expect(isAgentCreated(tmpDir, "nonexistent")).toBe(false);
  });

  it("removeManifestEntry removes an entry", () => {
    addManifestEntry(tmpDir, "temp-skill", "content");
    expect(isAgentCreated(tmpDir, "temp-skill")).toBe(true);
    removeManifestEntry(tmpDir, "temp-skill");
    expect(isAgentCreated(tmpDir, "temp-skill")).toBe(false);
  });

  it("removeManifestEntry is a no-op for non-existent entries", () => {
    expect(() => removeManifestEntry(tmpDir, "never-existed")).not.toThrow();
  });

  it("getAgentCreatedSkillNames returns only agent-created skills", () => {
    addManifestEntry(tmpDir, "skill-a", "content");
    addManifestEntry(tmpDir, "skill-b", "content");
    const names = getAgentCreatedSkillNames(tmpDir);
    expect(names).toContain("skill-a");
    expect(names).toContain("skill-b");
    expect(names.length).toBe(2);
  });

  it("updateManifestHash updates the hash after content change", () => {
    addManifestEntry(tmpDir, "evolving-skill", "v1 content");
    const oldHash = readManifest(tmpDir)["evolving-skill"].hash;
    updateManifestHash(tmpDir, "evolving-skill", "v2 content");
    const newHash = readManifest(tmpDir)["evolving-skill"].hash;
    expect(newHash).not.toBe(oldHash);
    expect(newHash).toBe(hashContent("v2 content"));
  });

  it("hashContent is deterministic", () => {
    const h1 = hashContent("hello world");
    const h2 = hashContent("hello world");
    expect(h1).toBe(h2);
  });

  it("hashContent produces different values for different content", () => {
    const h1 = hashContent("hello world");
    const h2 = hashContent("hello worlD");
    expect(h1).not.toBe(h2);
  });
});
