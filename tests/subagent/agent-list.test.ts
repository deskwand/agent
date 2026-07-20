import { describe, expect, it } from "vitest";
import { scanAgents } from "../../src/main/agent/subagent/agent-list";

describe("scanAgents", () => {
  it("returns built-in agents when no custom dirs exist", () => {
    const agents = scanAgents("/tmp/nonexistent");
    const names = agents.map((a) => a.name);
    expect(names).toContain("general-purpose");
    expect(names).toContain("Explore");
    expect(names).toContain("Plan");
  });

  it("each agent has displayName and description", () => {
    const agents = scanAgents("/tmp/nonexistent");
    for (const a of agents) {
      expect(a.name).toBeTruthy();
      expect(a.displayName).toBeTruthy();
      expect(typeof a.description).toBe("string");
      expect(["builtin", "global", "project"]).toContain(a.source);
    }
  });

  it("returns at least 3 built-in agents", () => {
    const agents = scanAgents("/tmp/nonexistent");
    expect(agents.length).toBeGreaterThanOrEqual(3);
  });

  it("deduplicates by name — last wins", () => {
    const agents = scanAgents("/tmp/nonexistent");
    const seen = new Set<string>();
    for (const a of agents) {
      expect(seen.has(a.name)).toBe(false);
      seen.add(a.name);
    }
  });

  it("built-in agents all have source=builtin with no markdownPath", () => {
    const agents = scanAgents("/tmp/nonexistent");
    const builtin = agents.filter((a) => a.source === "builtin");
    expect(builtin.length).toBeGreaterThanOrEqual(3);
    for (const a of builtin) {
      expect(a.markdownPath).toBeUndefined();
    }
  });
});
