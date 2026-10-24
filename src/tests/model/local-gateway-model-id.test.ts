import { describe, expect, it } from "vitest";
import { resolvePiRegistryModel } from "../../main/agent/pi-model-resolution";

const lookupOptions = {
  rawProvider: "custom",
  configProvider: "openai",
  customBaseUrl: "http://127.0.0.1:3425/v1",
  customProtocol: "openai" as const,
};

describe("resolvePiRegistryModel — local gateway model ids", () => {
  it("keeps the gateway namespace when the registry knows the inner id", () => {
    const model = resolvePiRegistryModel("opencode-go/kimi-k3", {
      ...lookupOptions,
      preserveModelId: true,
    });
    expect(model?.provider).toBe("opencode-go");
    expect(model?.id).toBe("opencode-go/kimi-k3");
  });

  it("still strips the namespace without the flag", () => {
    const model = resolvePiRegistryModel("opencode-go/kimi-k3", lookupOptions);
    expect(model?.id).toBe("kimi-k3");
  });
});
