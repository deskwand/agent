import { describe, expect, it } from "vitest";
import {
  isInstalled,
  normalizeInstalledSources,
} from "../../renderer/components/PiExtensionManagerView";

describe("installed-source normalization", () => {
  it("strips npm: prefix and version segments", () => {
    expect(
      normalizeInstalledSources([
        { source: "npm:pi-subagents", scope: "user" },
        { source: "npm:pi-x@^1.0", scope: "user" },
        { source: "npm:@scope/pkg@2.0.0", scope: "user" },
      ]),
    ).toEqual(["pi-subagents", "pi-x", "@scope/pkg"]);
  });

  it("takes tail segment for git/local paths", () => {
    expect(
      normalizeInstalledSources([
        { source: "git:github.com/user/repo@v1", scope: "user" },
        { source: "/tmp/local-ext", scope: "project" },
      ]),
    ).toEqual(["repo", "local-ext"]);
  });

  it("isInstalled matches by normalized name", () => {
    const installed = ["pi-subagents", "pi-x"];
    expect(isInstalled(installed, "pi-subagents")).toBe(true);
    expect(isInstalled(installed, "pi-y")).toBe(false);
  });
});
