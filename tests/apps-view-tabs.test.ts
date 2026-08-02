import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const appsViewPath = path.resolve(
  process.cwd(),
  "src/renderer/components/AppsView.tsx",
);
const appsViewContent = readFileSync(appsViewPath, "utf8");

describe("AppsView unified view", () => {
  it("defaults to the plugins tab", () => {
    expect(appsViewContent).toContain('useState<AppsTab>("plugins")');
  });

  it("renders two tabs with existing titles", () => {
    expect(appsViewContent).toContain('t("marketplace.title")');
    expect(appsViewContent).toContain('t("plugins.title")');
  });

  it("renders skills or plugins content by active tab", () => {
    expect(appsViewContent).toContain("<SettingsSkills isActive={true} />");
    expect(appsViewContent).toContain("<PiExtensionManagerView />");
  });

  it("moves team fetching into AppsView", () => {
    expect(appsViewContent).toContain("getTeams");
    expect(appsViewContent).toContain("setActiveTeamId");
  });
});
