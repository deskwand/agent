/**
 * Regression test: internal_browser_evaluate must always produce a text field
 * that is a string. The root cause of issue where page.evaluate(script)
 * returning `undefined` caused JSON.stringify(undefined) → undefined, which
 * produced a content block `{"type":"text"}` with no text field, crashing the
 * pi-ai SDK at `block.text.length`.
 */

import { describe, it, expect } from "vitest";

/**
 * Pure-function extraction of the text conversion logic used in
 * internal_browser_evaluate. Mirrors agent-runner.ts exactly.
 */
function evaluateResultToText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result === undefined) return "(no return value)";
  return JSON.stringify(result);
}

describe("internal_browser_evaluate text conversion", () => {
  it("produces a string for undefined result", () => {
    const text = evaluateResultToText(undefined);
    expect(typeof text).toBe("string");
    expect(text).toBe("(no return value)");
  });

  it("returns string result as-is", () => {
    expect(evaluateResultToText("hello")).toBe("hello");
    expect(evaluateResultToText("")).toBe("");
  });

  it("stringifies null", () => {
    expect(evaluateResultToText(null)).toBe("null");
  });

  it("stringifies numbers", () => {
    expect(evaluateResultToText(42)).toBe("42");
    expect(evaluateResultToText(0)).toBe("0");
    expect(evaluateResultToText(-1)).toBe("-1");
    expect(evaluateResultToText(3.14)).toBe("3.14");
  });

  it("stringifies booleans", () => {
    expect(evaluateResultToText(true)).toBe("true");
    expect(evaluateResultToText(false)).toBe("false");
  });

  it("stringifies objects", () => {
    expect(evaluateResultToText({ a: 1 })).toBe('{"a":1}');
    expect(evaluateResultToText([1, 2, 3])).toBe("[1,2,3]");
  });

  it("never returns undefined or non-string", () => {
    const inputs: unknown[] = [
      undefined,
      null,
      0,
      42,
      "",
      "text",
      true,
      false,
      {},
      [],
      { key: "value" },
      [1, 2, 3],
    ];
    for (const input of inputs) {
      const text = evaluateResultToText(input);
      expect(
        typeof text,
        `evaluateResultToText(${JSON.stringify(input)}) should be string`,
      ).toBe("string");
      expect(text).not.toBeUndefined();
    }
  });
});
