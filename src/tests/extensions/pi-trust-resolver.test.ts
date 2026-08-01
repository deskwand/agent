import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  PiTrustResolver,
  type TrustSettingsSource,
} from "../../main/extensions/pi-trust-resolver";

function makeAgentDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pi-trust-"));
}

function settings(policy: "ask" | "always" | "never"): TrustSettingsSource {
  return { getDefaultProjectTrust: () => policy };
}

describe("PiTrustResolver", () => {
  let agentDir: string;

  beforeEach(() => {
    agentDir = makeAgentDir();
  });

  it("uses saved decision without asking", async () => {
    const resolver = new PiTrustResolver(agentDir);
    resolver.writeDecision("/tmp/proj-x", true);
    const decision = await resolver.resolve({
      cwd: "/tmp/proj-x",
      agentDir,
      settingsManager: settings("ask"),
      askUser: () => Promise.resolve(null),
    });
    expect(decision).toBe("trusted");
  });

  it("asks user when no saved decision and default is ask", async () => {
    const resolver = new PiTrustResolver(agentDir);
    const asked: string[] = [];
    const decision = await resolver.resolve({
      cwd: "/tmp/proj-y",
      agentDir,
      settingsManager: settings("ask"),
      askUser: async (cwd) => {
        asked.push(cwd);
        return true;
      },
    });
    expect(asked).toEqual(["/tmp/proj-y"]);
    expect(decision).toBe("trusted");
  });

  it("honors defaultProjectTrust=always without asking", async () => {
    const resolver = new PiTrustResolver(agentDir);
    const asked: string[] = [];
    const decision = await resolver.resolve({
      cwd: "/tmp/proj-a",
      agentDir,
      settingsManager: settings("always"),
      askUser: async (cwd) => {
        asked.push(cwd);
        return true;
      },
    });
    expect(asked).toEqual([]);
    expect(decision).toBe("trusted");
  });

  it("persists user decision to trust.json", async () => {
    const resolver = new PiTrustResolver(agentDir);
    await resolver.resolve({
      cwd: "/tmp/proj-z",
      agentDir,
      settingsManager: settings("ask"),
      askUser: () => Promise.resolve(false),
    });
    const store = new (
      await import("@earendil-works/pi-coding-agent")
    ).ProjectTrustStore(agentDir);
    expect(store.get("/tmp/proj-z")).toBe(false);
  });
});
