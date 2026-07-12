/**
 * Regression test: verify that when toolsSignature invalidates the cached
 * Pi SDK session, conversation history is re-injected into contextualPrompt
 * via the shared injectHistoryPreamble helper.
 *
 * Bug: toolsSignature could change between turns (e.g. goal tools added/removed),
 * invalidating cachedSession AFTER the initial history injection check —
 * causing the new session to lose the conversation history entirely.
 *
 * Fix: a shared injectHistoryPreamble(local) function is called both on
 * cold start and as a re-injection fallback after toolsSignature invalidation,
 * guarded by historyWasInjected to prevent double injection.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const AGENT_RUNNER_PATH = path.join(
  __dirname,
  "../../main/agent/agent-runner.ts",
);

function readSource(): string {
  return fs.readFileSync(AGENT_RUNNER_PATH, "utf-8");
}

describe("AgentRunner contextualPrompt injection ordering", () => {
  it("injectHistoryPreamble function is defined before first call", () => {
    const src = readSource();

    const fnDefIdx = src.indexOf("const injectHistoryPreamble = (");
    const firstCallIdx = src.indexOf("injectHistoryPreamble(prompt,");

    expect(fnDefIdx, "injectHistoryPreamble must be defined").toBeGreaterThan(
      -1,
    );
    expect(firstCallIdx, "first call must exist").toBeGreaterThan(-1);
    expect(fnDefIdx).toBeLessThan(firstCallIdx);
  });

  it("historyWasInjected flag is declared before first call", () => {
    const src = readSource();

    const flagIdx = src.indexOf("let historyWasInjected = false;");
    const firstCallIdx = src.indexOf("injectHistoryPreamble(prompt,");

    expect(flagIdx, "historyWasInjected must exist").toBeGreaterThan(-1);
    expect(flagIdx).toBeLessThan(firstCallIdx);
  });

  it("toolsSignature invalidation occurs BEFORE re-injection fallback call", () => {
    const src = readSource();

    const toolsSigIdx = src.indexOf(
      "cachedSession.toolsSignature !== toolsSignature",
    );
    // The re-injection call uses contextualPrompt (not prompt) as first arg
    const reInjectCallIdx = src.indexOf(
      'injectHistoryPreamble(contextualPrompt, "Tools change cold-start")',
    );

    expect(toolsSigIdx, "toolsSignature check must exist").toBeGreaterThan(-1);
    expect(reInjectCallIdx, "re-injection call must exist").toBeGreaterThan(-1);
    expect(toolsSigIdx).toBeLessThan(reInjectCallIdx);
  });

  it("re-injection call guarded by !historyWasInjected", () => {
    const src = readSource();

    const guardIdx = src.indexOf(
      "if (!cachedSession && !historyWasInjected && !piSessionFile)",
    );
    const reInjectCallIdx = src.indexOf(
      'injectHistoryPreamble(contextualPrompt, "Tools change cold-start")',
    );

    expect(guardIdx, "double-injection guard must exist").toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(reInjectCallIdx);
  });

  it("re-injection call occurs BEFORE piSession creation", () => {
    const src = readSource();

    const reInjectCallIdx = src.indexOf(
      'injectHistoryPreamble(contextualPrompt, "Tools change cold-start")',
    );
    const piSessionIdx = src.indexOf("let piSession: PiAgentSession;");

    expect(piSessionIdx, "piSession declaration must exist").toBeGreaterThan(
      -1,
    );
    expect(reInjectCallIdx).toBeLessThan(piSessionIdx);
  });
});
