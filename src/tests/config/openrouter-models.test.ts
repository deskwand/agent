import { describe, expect, it, vi } from "vitest";
import {
  fetchOpenRouterModels,
  getOpenRouterFallbackModels,
  isOpenRouterFreeModel,
} from "../../main/config/openrouter-models";

describe("openrouter-models", () => {
  it("detects free models from zero pricing", () => {
    expect(
      isOpenRouterFreeModel({
        prompt: "0",
        completion: "0",
      }),
    ).toBe(true);
    expect(
      isOpenRouterFreeModel({
        prompt: "0.000001",
        completion: "0",
      }),
    ).toBe(false);
  });

  it("sorts free models first and appends a free label", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: "paid/model",
                name: "Paid Model",
                context_length: 64000,
                top_provider: { max_completion_tokens: 4096 },
                architecture: { input_modalities: ["text"] },
                pricing: { prompt: "0.000001", completion: "0.000002" },
              },
              {
                id: "free/model",
                name: "Free Model",
                context_length: 128000,
                top_provider: { max_completion_tokens: 8192 },
                architecture: { input_modalities: ["text", "image"] },
                pricing: { prompt: "0", completion: "0" },
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );

    const result = await fetchOpenRouterModels(fetchMock);

    expect(result.usedFallback).toBe(false);
    expect(result.models[0]).toMatchObject({
      id: "free/model",
      label: expect.stringContaining("Free"),
      contextWindow: 128000,
      maxTokens: 8192,
      input: ["text", "image"],
    });
    expect(result.models[1].id).toBe("paid/model");
  });

  it("falls back to preset models when the API returns an empty list", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    const result = await fetchOpenRouterModels(fetchMock);

    expect(result.usedFallback).toBe(true);
    expect(result.models).toEqual(getOpenRouterFallbackModels());
  });

  it("falls back to preset models when the API request fails", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });

    const result = await fetchOpenRouterModels(fetchMock);

    expect(result.usedFallback).toBe(true);
    expect(result.models).toEqual(getOpenRouterFallbackModels());
  });
});
