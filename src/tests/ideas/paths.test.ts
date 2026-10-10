import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/ideas-home" },
}));

import { getIdeasRoot } from "../../main/ideas/paths";
import { VAULT_MODULES, isVaultModule } from "../../main/vault/local-store";

describe("ideas 路径", () => {
  it("落在密库根下的 ideas/ 目录", () => {
    expect(getIdeasRoot()).toBe("/tmp/ideas-home/.deskwand/vault/ideas");
  });
});

describe("密库模块枚举", () => {
  it("ideas 是一个已注册的模块", () => {
    expect(VAULT_MODULES).toContain("ideas");
    expect(isVaultModule("ideas")).toBe(true);
  });
});
