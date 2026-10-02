// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONNECT_TIMEOUT_MS,
  ConnectTimeoutError,
  diagnoseProviderModels,
} from "../../renderer/services/connect-models";

describe("diagnoseProviderModels", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("passes the diagnostics result through", async () => {
    const diagnose = vi.fn(async () => ({
      steps: [],
      overallOk: true,
      totalLatencyMs: 12,
    }));
    window.electronAPI = {
      config: { diagnose },
    } as unknown as typeof window.electronAPI;

    const result = await diagnoseProviderModels({
      provider: "openai",
      apiKey: "sk-test",
      captureModels: true,
    });

    expect(result.overallOk).toBe(true);
    expect(diagnose).toHaveBeenCalledWith({
      provider: "openai",
      apiKey: "sk-test",
      captureModels: true,
    });
  });

  it("rejects with ConnectTimeoutError after the budget", async () => {
    vi.useFakeTimers();
    const diagnose = vi.fn(() => new Promise(() => {}));
    window.electronAPI = {
      config: { diagnose },
    } as unknown as typeof window.electronAPI;

    const pending = diagnoseProviderModels({
      provider: "openai",
      apiKey: "k",
    });
    const assertion =
      expect(pending).rejects.toBeInstanceOf(ConnectTimeoutError);
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS + 1);
    await assertion;
  });
});
