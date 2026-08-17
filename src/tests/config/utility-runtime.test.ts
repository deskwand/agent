import { describe, expect, it } from "vitest";
import {
  ConfigStore,
  defaultStoredConfig,
} from "../../main/config/config-store";

describe("utilityRuntime normalize", () => {
  it("defaults to inheritFromActive", () => {
    expect(defaultStoredConfig().utilityRuntime).toMatchObject({
      inheritFromActive: true,
      providerProfileKey: undefined,
      model: "",
      timeoutMs: 180000,
    });
  });

  it("clamps timeoutMs and drops invalid providerProfileKey", () => {
    const store = new ConfigStore();
    store.update({
      utilityRuntime: {
        inheritFromActive: false,
        providerProfileKey: "",
        model: "deepseek-chat",
        timeoutMs: 100,
      },
    });
    expect(store.get("utilityRuntime")).toMatchObject({
      inheritFromActive: false,
      model: "deepseek-chat",
      timeoutMs: 5000,
    });
    expect(store.get("utilityRuntime").providerProfileKey).toBeUndefined();
  });
});
