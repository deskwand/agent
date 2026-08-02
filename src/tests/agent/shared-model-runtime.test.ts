import { beforeEach, describe, expect, it, vi } from "vitest";

const createModelRuntimeMock = vi.hoisted(() => vi.fn());

vi.mock("@earendil-works/pi-coding-agent", () => ({
  ModelRuntime: { create: createModelRuntimeMock },
}));

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/deskwand-user-data") },
}));

describe("shared-model-runtime", () => {
  beforeEach(() => {
    vi.resetModules();
    createModelRuntimeMock.mockReset();
  });

  it("coalesces concurrent initialization", async () => {
    const runtime = { getAuth: vi.fn() };
    createModelRuntimeMock.mockResolvedValue(runtime);
    const { getSharedModelRuntime } =
      await import("../../main/agent/shared-model-runtime");

    const [first, second] = await Promise.all([
      getSharedModelRuntime(),
      getSharedModelRuntime(),
    ]);

    expect(first).toBe(runtime);
    expect(second).toBe(runtime);
    expect(createModelRuntimeMock).toHaveBeenCalledTimes(1);
    expect(createModelRuntimeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        authPath: "/tmp/deskwand-user-data/auth.json",
        modelsPath: null,
        allowModelNetwork: false,
        credentials: expect.any(Object),
      }),
    );
  });

  it("retries after initialization failure", async () => {
    const runtime = { getAuth: vi.fn() };
    createModelRuntimeMock
      .mockRejectedValueOnce(new Error("init failed"))
      .mockResolvedValueOnce(runtime);
    const { getSharedModelRuntime } =
      await import("../../main/agent/shared-model-runtime");

    await expect(getSharedModelRuntime()).rejects.toThrow("init failed");
    await expect(getSharedModelRuntime()).resolves.toBe(runtime);
    expect(createModelRuntimeMock).toHaveBeenCalledTimes(2);
  });

  it("extracts only an API key from resolved auth", async () => {
    const getAuth = vi
      .fn()
      .mockResolvedValueOnce({ auth: { apiKey: "oauth-key" } })
      .mockResolvedValueOnce({
        auth: { headers: { Authorization: "Bearer x" } },
      });
    createModelRuntimeMock.mockResolvedValue({ getAuth });
    const { resolveProviderApiKey } =
      await import("../../main/agent/shared-model-runtime");

    await expect(resolveProviderApiKey("openai-codex")).resolves.toBe(
      "oauth-key",
    );
    await expect(resolveProviderApiKey("header-only")).resolves.toBeUndefined();
  });
});
