import { describe, expect, it } from "vitest";
import {
  getLocalGatewayPreset,
  isLocalGatewayId,
  shouldPreserveModelId,
} from "../../shared/local-gateways";

describe("local gateway presets", () => {
  it("describes magpie's loopback endpoint", () => {
    const magpie = getLocalGatewayPreset("magpie");
    expect(magpie?.baseUrl).toBe("http://127.0.0.1:3425/v1");
    expect(magpie?.defaultApiKey).toBe("magpie");
    expect(magpie?.protocol).toBe("openai");
    expect(magpie?.passthroughModelIds).toBe(true);
  });

  it("only accepts known ids", () => {
    expect(isLocalGatewayId("magpie")).toBe(true);
    expect(isLocalGatewayId("nope")).toBe(false);
    expect(isLocalGatewayId(undefined)).toBe(false);
  });

  it("turns model id passthrough on only for passthrough presets", () => {
    expect(shouldPreserveModelId({ localGateway: "magpie" })).toBe(true);
    expect(shouldPreserveModelId(undefined)).toBe(false);
    expect(shouldPreserveModelId({})).toBe(false);
  });
});
