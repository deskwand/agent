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

describe("cloud provider lifecycle wiring", () => {
  it("injects the provider after login with modes", () => {
    expect(loginModal).toContain(
      "buildDeskwandProviderPayload(config.modes, result.token)",
    );
    expect(loginModal).toContain(
      "window.electronAPI.config.saveProvider(payload)",
    );
  });

  it("removes the provider on logout and on startup 401 restore", () => {
    expect(sidebar).toContain('profileKey: "custom:deskwand"');
    const occurrences = sidebar.split("deleteProvider(").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("hides the provider from the manual API settings list", () => {
    expect(settingsApi).toContain('profileKey !== "custom:deskwand"');
  });
});
