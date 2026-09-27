import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const loginModal = fs.readFileSync(
  path.resolve(process.cwd(), "src/renderer/components/LoginModal.tsx"),
  "utf8",
);
const sidebar = fs.readFileSync(
  path.resolve(process.cwd(), "src/renderer/components/Sidebar.tsx"),
  "utf8",
);
const settingsApi = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "src/renderer/components/settings/SettingsAPI.tsx",
  ),
  "utf8",
);
// 账号簇（含启动恢复登录与服务商重建/清理）已从 Sidebar 搬到图标栏底部
const accountCluster = fs.readFileSync(
  path.resolve(process.cwd(), "src/renderer/components/AccountCluster.tsx"),
  "utf8",
);

describe("cloud provider lifecycle wiring", () => {
  it("injects the provider after login using pricing, not modes", () => {
    expect(loginModal).toContain("buildDeskwandProviderPayload(");
    expect(loginModal).toContain("getPricing()");
    expect(loginModal).not.toContain("getModes");
    expect(loginModal).toContain("result.token");
    expect(loginModal).toContain(
      "window.electronAPI.config.saveProvider(payload)",
    );
  });

  it("rebuilds the provider on startup restore so existing users get real model names", () => {
    expect(accountCluster).toContain("buildDeskwandProviderPayload(");
    expect(accountCluster).toContain("config.saveProvider(payload)");
    expect(accountCluster).toContain("getPricing()");
    expect(accountCluster).not.toContain("getModes");
  });

  it("removes the provider on logout and on startup 401 restore", () => {
    expect(accountCluster).toContain('profileKey: "custom:deskwand"');
    const occurrences = accountCluster.split("deleteProvider(").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("only activates the cloud provider when nothing was configured before", () => {
    expect(loginModal).toContain(
      "const alreadyConfigured = await window.electronAPI.config.isConfigured();",
    );
    expect(loginModal).toContain("if (!alreadyConfigured && defaultModel)");
  });

  it("hides the provider from the manual API settings list", () => {
    expect(settingsApi).toContain('profileKey !== "custom:deskwand"');
  });
});
