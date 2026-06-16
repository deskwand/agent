import { describe, expect, it } from "vitest";
import {
  applyAutomaticTransitions,
  type AgentCreatedSkillMeta,
} from "../src/main/skills/curator-transitions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCandidates(
  ...entries: Array<{
    name: string;
    daysAgo: number;
    useCount?: number;
    status?: "active" | "stale" | "archived";
  }>
): AgentCreatedSkillMeta[] {
  return entries.map((e) => ({
    name: e.name,
    description: `desc-${e.name}`,
    usage: {
      lastUsedAt: Date.now() - e.daysAgo * 86400000,
      useCount: e.useCount ?? 10,
      lastUsed: e.status ?? "active",
    },
    skillDir: `/tmp/skills/${e.name}`,
  }));
}

// ---------------------------------------------------------------------------
// applyAutomaticTransitions
// ---------------------------------------------------------------------------

describe("applyAutomaticTransitions", () => {
  it("returns empty for no candidates", () => {
    expect(applyAutomaticTransitions([])).toEqual([]);
  });

  it("returns empty when no usage data", () => {
    const candidates = [{ name: "a", description: "d", usage: null, skillDir: "/tmp/skills/a" }];
    expect(applyAutomaticTransitions(candidates)).toEqual([]);
  });

  it("marks stale when > 30 days unused", () => {
    const candidates = makeCandidates({ name: "old-skill", daysAgo: 35, status: "active" });
    expect(applyAutomaticTransitions(candidates)).toEqual([
      { skill: "old-skill", from: "active", to: "stale" },
    ]);
  });

  it("marks archived when > 90 days unused", () => {
    const candidates = makeCandidates({ name: "ancient", daysAgo: 100, status: "active" });
    expect(applyAutomaticTransitions(candidates)).toEqual([
      { skill: "ancient", from: "active", to: "archived" },
    ]);
  });

  it("reactivates stale skill when recently used", () => {
    const candidates = makeCandidates({ name: "revived", daysAgo: 5, status: "stale" });
    expect(applyAutomaticTransitions(candidates)).toEqual([
      { skill: "revived", from: "stale", to: "active" },
    ]);
  });

  it("leaves active skill alone when recently used", () => {
    const candidates = makeCandidates({ name: "fresh", daysAgo: 3, status: "active" });
    expect(applyAutomaticTransitions(candidates)).toEqual([]);
  });

  it("leaves archived skill alone", () => {
    const candidates = makeCandidates({ name: "done", daysAgo: 200, status: "archived" });
    expect(applyAutomaticTransitions(candidates)).toEqual([]);
  });

  it("handles mixed batch", () => {
    const candidates = makeCandidates(
      { name: "fresh", daysAgo: 3, status: "active" },
      { name: "stale", daysAgo: 45, status: "active" },
      { name: "ancient", daysAgo: 120, status: "active" },
      { name: "revived", daysAgo: 10, status: "stale" },
    );
    const result = applyAutomaticTransitions(candidates);
    expect(result).toHaveLength(3);
    expect(result).toContainEqual({ skill: "stale", from: "active", to: "stale" });
    expect(result).toContainEqual({ skill: "ancient", from: "active", to: "archived" });
    expect(result).toContainEqual({ skill: "revived", from: "stale", to: "active" });
  });
});
