import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PiExtensionHost } from "../../main/extensions/pi-extension-host";
import { mergeCommandEntries } from "../../main/extensions/pi-command-registry";

describe("commands.list lazy loading", () => {
  let base: string;
  let agentDir: string;
  let cwd: string;

  beforeAll(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cmd-lazy-"));
    agentDir = path.join(base, "agent");
    cwd = path.join(base, "project");
    fs.mkdirSync(path.join(agentDir, "extensions"), { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, "extensions", "test-cmd.ts"),
      `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: ExtensionAPI) {
  pi.registerCommand("testcmd", { description: "test", handler: async () => {} });
}`,
    );
  });

  afterAll(() => {
    PiExtensionHost.registry.clear();
  });

  it("new host reports no extension commands before reload", () => {
    const host = PiExtensionHost.getOrCreate({ cwd, agentDir });
    const cmds = mergeCommandEntries(
      undefined,
      host.getRegisteredCommands().map((c) => ({ ...c, source: "extension" as const })),
    );
    expect(cmds.filter((c) => c.source === "extension")).toHaveLength(0);
  });

  it("after reload the extension command appears (lazy-load fix contract)", async () => {
    const host = PiExtensionHost.getOrCreate({ cwd, agentDir });
    await host.reloadResources();
    const cmds = mergeCommandEntries(
      undefined,
      host.getRegisteredCommands().map((c) => ({ ...c, source: "extension" as const })),
    );
    expect(cmds.filter((c) => c.source === "extension").map((c) => c.name)).toContain(
      "testcmd",
    );
  });
});
