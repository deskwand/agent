import { describe, expect, it } from "vitest";
import { normalizeTokenUsage } from "../../main/usage/normalize-usage";

describe("normalizeTokenUsage", () => {
  it("reads the pi-normalized shape", () => {
    expect(
      normalizeTokenUsage({
        input: 10,
        output: 20,
        cacheRead: 30,
        cacheWrite: 4,
      }),
    ).toMatchObject({ input: 10, output: 20, cacheRead: 30, cacheWrite: 4 });
  });

  it("reads Anthropic raw field names", () => {
    expect(
      normalizeTokenUsage(
        {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 4,
        },
        "anthropic",
      ),
    ).toMatchObject({ input: 10, output: 20, cacheRead: 30, cacheWrite: 4 });
  });

  it("reads OpenAI raw field names and subtracts the cached part of the prompt total", () => {
    // Real payload shape: prompt_tokens INCLUDES the cached tokens.
    const result = normalizeTokenUsage({
      prompt_tokens: 40,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 30 },
    });
    expect(result).toMatchObject({ input: 10, output: 20, cacheRead: 30 });
    expect(result?.totalPromptInput).toBe(40);
  });

  it("reads Gemini usageMetadata field names and subtracts the cached part", () => {
    const result = normalizeTokenUsage(
      {
        promptTokenCount: 40,
        candidatesTokenCount: 20,
        cachedContentTokenCount: 30,
      },
      "gemini",
    );
    expect(result).toMatchObject({ input: 10, output: 20, cacheRead: 30 });
    expect(result?.totalPromptInput).toBe(40);
  });

  it("returns undefined when input/output are missing", () => {
    expect(normalizeTokenUsage({ cacheRead: 30 })).toBeUndefined();
    expect(normalizeTokenUsage(undefined)).toBeUndefined();
  });

  it("counts the full prompt against the context window for non-Anthropic providers", () => {
    expect(
      normalizeTokenUsage(
        { input: 10, output: 1, cacheRead: 30, cacheWrite: 4 },
        "openai",
      )?.totalPromptInput,
    ).toBe(44);
  });

  it("preserves the existing Anthropic branch verbatim (behavior-preserving move)", () => {
    // This is the pre-move behavior: Anthropic counts input only. It is not
    // "fixed" here — that question is tracked separately in the design doc.
    expect(
      normalizeTokenUsage(
        { input: 10, output: 1, cacheRead: 30, cacheWrite: 4 },
        "anthropic",
      )?.totalPromptInput,
    ).toBe(10);
  });
});
