import { describe, expect, it } from "vitest";
import {
  collectInlineArtifactsByTurn,
  filterInlineArtifactFiles,
  normalizeArtifactKey,
} from "../../renderer/utils/inline-artifacts";
import type { Message, TraceStep } from "../../renderer/types";

function userMsg(id: string, timestamp: number): Message {
  return { id, sessionId: "s", role: "user", content: [], timestamp };
}

function assistantMsg(id: string, timestamp: number, turnId?: string): Message {
  return {
    id,
    sessionId: "s",
    role: "assistant",
    content: [],
    timestamp,
    turnId,
  };
}

function artifactStep(
  id: string,
  timestamp: number,
  payload: Record<string, unknown>,
): TraceStep {
  return {
    id,
    type: "tool_result",
    status: "completed",
    title: "artifact",
    toolName: "artifact",
    toolOutput: JSON.stringify(payload),
    timestamp,
  };
}

describe("normalizeArtifactKey", () => {
  it("unifies separators and strips a leading ./", () => {
    expect(normalizeArtifactKey(".\\out\\report.html")).toBe("out/report.html");
    expect(normalizeArtifactKey("./out/report.html")).toBe("out/report.html");
  });
});

describe("collectInlineArtifactsByTurn", () => {
  it("assigns a step to the turn whose user message precedes it", () => {
    const messages = [userMsg("u1", 100), assistantMsg("a1", 200)];
    const steps = [
      artifactStep("s1", 150, { path: "out/a.html", render: "inline" }),
    ];

    const result = collectInlineArtifactsByTurn(messages, steps);
    expect(result.get("a1")).toEqual([
      { path: "out/a.html", name: undefined, type: undefined },
    ]);
    expect(result.size).toBe(1);
  });

  it("keeps two turns apart", () => {
    const messages = [
      userMsg("u1", 100),
      assistantMsg("a1", 200),
      userMsg("u2", 300),
      assistantMsg("a2", 400),
    ];
    const steps = [
      artifactStep("s1", 150, { path: "first.html", render: "inline" }),
      artifactStep("s2", 350, { path: "second.html", render: "inline" }),
    ];

    const result = collectInlineArtifactsByTurn(messages, steps);
    expect(result.get("a1")?.[0].path).toBe("first.html");
    expect(result.get("a2")?.[0].path).toBe("second.html");
  });

  it("skips steps without the inline marker", () => {
    const messages = [userMsg("u1", 100), assistantMsg("a1", 200)];
    const steps = [artifactStep("s1", 150, { path: "out/a.html" })];
    expect(collectInlineArtifactsByTurn(messages, steps).size).toBe(0);
  });

  it("skips non-artifact steps and malformed payloads", () => {
    const messages = [userMsg("u1", 100), assistantMsg("a1", 200)];
    const steps: TraceStep[] = [
      {
        id: "t1",
        type: "tool_result",
        status: "completed",
        title: "read_file",
        toolName: "read_file",
        timestamp: 150,
      },
      {
        id: "t2",
        type: "tool_result",
        status: "completed",
        title: "artifact",
        toolName: "artifact",
        toolOutput: "not json",
        timestamp: 160,
      },
      artifactStep("t3", 170, { render: "inline" }),
    ];
    expect(collectInlineArtifactsByTurn(messages, steps).size).toBe(0);
  });

  it("keeps model order when a turn has several artifacts", () => {
    const messages = [userMsg("u1", 100), assistantMsg("a1", 200)];
    const steps = [
      artifactStep("s1", 150, { path: "b.html", render: "inline" }),
      artifactStep("s2", 160, { path: "a.html", render: "inline" }),
    ];
    const result = collectInlineArtifactsByTurn(messages, steps);
    expect(result.get("a1")?.map((a) => a.path)).toEqual(["b.html", "a.html"]);
  });

  it("ignores steps that arrive before any user message", () => {
    const messages = [userMsg("u1", 100), assistantMsg("a1", 200)];
    const steps = [
      artifactStep("s1", 50, { path: "early.html", render: "inline" }),
    ];
    expect(collectInlineArtifactsByTurn(messages, steps).size).toBe(0);
  });
});

describe("filterInlineArtifactFiles", () => {
  const files = [
    { path: "out/report.html" },
    { path: "out/data.csv" },
    { path: "notes.md" },
  ];

  it("drops the paths rendered inline", () => {
    const result = filterInlineArtifactFiles(files, [
      { path: "out/report.html" },
    ]);
    expect(result.map((file) => file.path)).toEqual([
      "out/data.csv",
      "notes.md",
    ]);
  });

  it("matches across separator and ./ differences", () => {
    const result = filterInlineArtifactFiles(files, [
      { path: ".\\out\\report.html" },
    ]);
    expect(result.map((file) => file.path)).toEqual([
      "out/data.csv",
      "notes.md",
    ]);
  });

  it("returns the same array when nothing is inline", () => {
    expect(filterInlineArtifactFiles(files, [])).toBe(files);
  });
});
