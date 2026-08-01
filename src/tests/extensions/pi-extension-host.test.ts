/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PiExtensionHost } from "../../main/extensions/pi-extension-host";

function makeTempProject(): { dir: string; agentDir: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-host-test-"));
  const project = path.join(base, "project");
  const agentDir = path.join(base, "agent");
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(path.join(agentDir, "extensions"), { recursive: true });
  return { dir: project, agentDir };
}

describe("PiExtensionHost", () => {
  let ctx: { dir: string; agentDir: string } | undefined;

  beforeEach(() => {
    ctx = makeTempProject();
    PiExtensionHost.registry.clear();
  });

  afterEach(() => {
    for (const host of [...PiExtensionHost.registry.values()]) host.dispose();
    PiExtensionHost.registry.clear();
  });

  it("creates one host per cwd via getOrCreate", () => {
    const a = PiExtensionHost.getOrCreate({ cwd: ctx!.dir, agentDir: ctx!.agentDir });
    const b = PiExtensionHost.getOrCreate({ cwd: ctx!.dir, agentDir: ctx!.agentDir });
    expect(a).toBe(b);
    expect(PiExtensionHost.registry.size).toBe(1);
  });

  it("loads global extensions from agentDir/extensions", async () => {
    fs.writeFileSync(
      path.join(ctx!.agentDir, "extensions", "hello.ts"),
      `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: ExtensionAPI) {
  pi.registerTool({ name: "host_test_greet", label: "Greet", description: "greet",
    parameters: {} as any,
    execute: async () => ({ content: [{ type: "text", text: "hi" }], details: {} }) });
}`,
    );
    const host = PiExtensionHost.getOrCreate({ cwd: ctx!.dir, agentDir: ctx!.agentDir });
    await host.reloadResources();
    const tools = host.getExtensionsResult().extensions.flatMap((e) => [
      ...e.tools.keys(),
    ]);
    expect(tools).toContain("host_test_greet");
    expect(host.getExtensionErrors()).toEqual([]);
  });

  it("reports SDK version from bundled package", () => {
    const host = PiExtensionHost.getOrCreate({ cwd: ctx!.dir, agentDir: ctx!.agentDir });
    expect(host.getCompatibleSdkVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("PiExtensionHost trust gating", () => {
  it("does not load project .pi/extensions when trust is denied", async () => {
    const ctx = makeTempProject();
    // 项目扩展：project/.pi/extensions/*
    const projectExtDir = path.join(ctx.dir, ".pi", "extensions");
    fs.mkdirSync(projectExtDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectExtDir, "proj-ext.ts"),
      `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: ExtensionAPI) {
  pi.registerTool({ name: "proj_secret_tool", label: "x", description: "x",
    parameters: {} as any,
    execute: async () => ({ content: [{ type: "text", text: "x" }], details: {} }) });
}`,
    );
    const host = PiExtensionHost.getOrCreate({
      cwd: ctx.dir,
      agentDir: ctx.agentDir,
      onTrustPrompt: () => Promise.resolve(false), // 用户拒绝
    });
    await host.reloadResources({ resolveProjectTrust: true });
    const tools = host.getExtensionsResult().extensions.flatMap((e) => [
      ...e.tools.keys(),
    ]);
    expect(tools).not.toContain("proj_secret_tool");
    host.dispose();
  });

  it("loads project .pi/extensions when trust is granted", async () => {
    const ctx = makeTempProject();
    const projectExtDir = path.join(ctx.dir, ".pi", "extensions");
    fs.mkdirSync(projectExtDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectExtDir, "proj-ext.ts"),
      `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: ExtensionAPI) {
  pi.registerTool({ name: "proj_secret_tool", label: "x", description: "x",
    parameters: {} as any,
    execute: async () => ({ content: [{ type: "text", text: "x" }], details: {} }) });
}`,
    );
    const host = PiExtensionHost.getOrCreate({
      cwd: ctx.dir,
      agentDir: ctx.agentDir,
      onTrustPrompt: () => Promise.resolve(true), // 用户信任
    });
    await host.reloadResources({ resolveProjectTrust: true });
    const tools = host.getExtensionsResult().extensions.flatMap((e) => [
      ...e.tools.keys(),
    ]);
    expect(tools).toContain("proj_secret_tool");
    host.dispose();
  });
});
