import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/main/config/config-store";
import {
  isDeepSeekAuth,
  resolveWebAccessProviderAuth,
} from "../src/main/agent/tools/web-access/config-adapter";

function appConfigWith(providers: Record<string, unknown>): AppConfig {
  return { providers } as unknown as AppConfig;
}

const noToken = async () => undefined;

describe("resolveWebAccessProviderAuth deepseek", () => {
  it("dedicated: empty apiKey and empty baseUrl counts as unconfigured", async () => {
    const auth = await resolveWebAccessProviderAuth(
      "deepseek",
      { source: "dedicated", profileKey: "", apiKey: "", baseUrl: "" },
      appConfigWith({}),
      noToken,
    );
    expect(auth).toBeUndefined();
  });

  it("dedicated: local proxy with only baseUrl is usable without apiKey", async () => {
    const auth = await resolveWebAccessProviderAuth(
      "deepseek",
      {
        source: "dedicated",
        profileKey: "",
        apiKey: "",
        baseUrl: "http://127.0.0.1:11234",
      },
      appConfigWith({}),
      noToken,
    );
    expect(auth).toEqual({
      apiKey: "",
      baseUrl: "http://127.0.0.1:11234",
      model: "deepseek-v4-flash",
    });
  });

  it("dedicated: passes through apiKey and baseUrl", async () => {
    const auth = await resolveWebAccessProviderAuth(
      "deepseek",
      {
        source: "dedicated",
        profileKey: "",
        apiKey: "sk-abc",
        baseUrl: "http://127.0.0.1:11234",
      },
      appConfigWith({}),
      noToken,
    );
    expect(auth).toEqual({
      apiKey: "sk-abc",
      baseUrl: "http://127.0.0.1:11234",
      model: "deepseek-v4-flash",
    });
  });

  it("inherit: reuses deepseek model provider profile", async () => {
    const auth = await resolveWebAccessProviderAuth(
      "deepseek",
      { source: "inherit", profileKey: "deepseek", apiKey: "", baseUrl: "" },
      appConfigWith({
        deepseek: {
          apiKey: "sk-profile",
          baseUrl: "https://api.deepseek.com/v1",
          model: "deepseek-v4-pro",
        },
      }),
      noToken,
    );
    expect(auth).toEqual({
      apiKey: "sk-profile",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-v4-flash",
    });
  });

  it("inherit: allows empty apiKey when profile is deepseek", async () => {
    const auth = await resolveWebAccessProviderAuth(
      "deepseek",
      { source: "inherit", profileKey: "deepseek", apiKey: "", baseUrl: "" },
      appConfigWith({
        deepseek: { apiKey: "", baseUrl: "http://127.0.0.1:11234" },
      }),
      noToken,
    );
    expect(auth?.apiKey).toBe("");
    expect(auth?.baseUrl).toBe("http://127.0.0.1:11234");
  });

  it("inherit: empty profile key and baseUrl counts as unconfigured", async () => {
    const auth = await resolveWebAccessProviderAuth(
      "deepseek",
      { source: "inherit", profileKey: "deepseek", apiKey: "", baseUrl: "" },
      appConfigWith({ deepseek: { apiKey: "", baseUrl: "" } }),
      noToken,
    );
    expect(auth).toBeUndefined();
  });

  it("inherit: returns undefined for non-deepseek profile", async () => {
    const auth = await resolveWebAccessProviderAuth(
      "deepseek",
      { source: "inherit", profileKey: "openai", apiKey: "", baseUrl: "" },
      appConfigWith({ openai: { apiKey: "x" } }),
      noToken,
    );
    expect(auth).toBeUndefined();
  });

  it("other providers keep requiring non-empty apiKey", async () => {
    const auth = await resolveWebAccessProviderAuth(
      "gemini",
      { source: "dedicated", profileKey: "", apiKey: "", baseUrl: "" },
      appConfigWith({}),
      noToken,
    );
    expect(auth).toBeUndefined();
  });

  it("isDeepSeekAuth narrows by absence of provider field", async () => {
    const deep = await resolveWebAccessProviderAuth(
      "deepseek",
      {
        source: "dedicated",
        profileKey: "",
        apiKey: "",
        baseUrl: "http://127.0.0.1:11234",
      },
      appConfigWith({}),
      noToken,
    );
    const open = await resolveWebAccessProviderAuth(
      "openai",
      {
        source: "dedicated",
        profileKey: "",
        apiKey: "sk-x",
        baseUrl: "https://api.openai.com/v1",
      },
      appConfigWith({}),
      noToken,
    );
    expect(deep && isDeepSeekAuth(deep)).toBe(true);
    expect(open && isDeepSeekAuth(open)).toBe(false);
  });
});
