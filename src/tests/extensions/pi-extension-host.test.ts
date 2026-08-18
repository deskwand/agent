/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PiExtensionHost } from "../../main/extensions/pi-extension-host";

const state = vi.hoisted(() => ({ mockHome: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof os;
  return { ...actual, homedir: () => state.mockHome };
});

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
    const a = PiExtensionHost.getOrCreate({
      cwd: ctx!.dir,
      agentDir: ctx!.agentDir,
    });
    const b = PiExtensionHost.getOrCreate({
      cwd: ctx!.dir,
      agentDir: ctx!.agentDir,
    });
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
    const host = PiExtensionHost.getOrCreate({
      cwd: ctx!.dir,
      agentDir: ctx!.agentDir,
    });
    await host.reloadResources();
    const tools = host
      .getExtensionsResult()
      .extensions.flatMap((e) => [...e.tools.keys()]);
    expect(tools).toContain("host_test_greet");
    expect(host.getExtensionErrors()).toEqual([]);
  });

  it("reports SDK version from bundled package", () => {
    const host = PiExtensionHost.getOrCreate({
      cwd: ctx!.dir,
      agentDir: ctx!.agentDir,
    });
    expect(host.getCompatibleSdkVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("createSessionResourceLoader returns a loader with extra inline factories", async () => {
    const host = PiExtensionHost.getOrCreate({
      cwd: ctx!.dir,
      agentDir: ctx!.agentDir,
    });
    await host.reloadResources();
    const loader = await host.createSessionResourceLoader([
      {
        name: "session-test-ext",
        factory: (pi) => {
          pi.registerTool({
            name: "session_only_tool",
            label: "Session Only",
            description: "registered per session",
            parameters: {},
            execute: async () => ({
              content: [{ type: "text", text: "ok" }],
              details: {},
            }),
          });
        },
      },
    ]);
    const tools = loader
      .getExtensions()
      .extensions.flatMap((e) => [...e.tools.keys()]);
    expect(tools).toContain("session_only_tool");
    // host 自身 loader 不受会话级工厂污染
    const hostTools = host
      .getExtensionsResult()
      .extensions.flatMap((e) => [...e.tools.keys()]);
    expect(hostTools).not.toContain("session_only_tool");
    // 派生 loader 与 host 共享 settingsManager（信任状态继承）
    expect(loader).not.toBe(host.getResourceLoader());
  });

  it("derived loader carries subagent factories even when host was created first (IPC race)", async () => {
    // 模拟 IPC 处理器：先 getOrCreate（无 inline 工厂）并 reload
    const host = PiExtensionHost.getOrCreate({
      cwd: ctx!.dir,
      agentDir: ctx!.agentDir,
    });
    await host.reloadResources();
    // 模拟 AgentRunner：之后派生会话 loader（带 pi-subagents 工厂）
    const loader = await host.createSessionResourceLoader([
      {
        name: "pi-subagents-wrapped",
        factory: (pi) => {
          pi.registerTool({
            name: "Agent",
            label: "Agent",
            description: "spawn a sub-agent",
            parameters: {},
            execute: async () => ({
              content: [{ type: "text", text: "ok" }],
              details: {},
            }),
          });
        },
      },
    ]);
    const tools = loader
      .getExtensions()
      .extensions.flatMap((e) => [...e.tools.keys()]);
    expect(tools).toContain("Agent");
    // 且 host 仍无该工具（IPC 路径不受污染）
    const hostTools = host
      .getExtensionsResult()
      .extensions.flatMap((e) => [...e.tools.keys()]);
    expect(hostTools).not.toContain("Agent");
  });

  it("derived loader honors skill path overrides (host-cache stale value guard)", async () => {
    const host = PiExtensionHost.getOrCreate({
      cwd: ctx!.dir,
      agentDir: ctx!.agentDir,
    });
    await host.reloadResources();
    const sessionSkills = [path.join(ctx!.dir, "session-skills")];
    fs.mkdirSync(sessionSkills[0], { recursive: true });
    const loader = await host.createSessionResourceLoader([], {
      additionalSkillPaths: sessionSkills,
    });
    // 会话级 skillPaths 覆盖 host 首次构造值（host 缓存后新值会被 getOrCreate 忽略）
    const hostSkills = host
      .getExtensionsResult()
      .extensions.flatMap((e) => [...e.tools.keys()]);
    expect(loader).not.toBe(host.getResourceLoader());
    expect(loader.getSkills().skills).toEqual(expect.any(Array));
    expect(hostSkills).toEqual(expect.any(Array));
  });

  it("injects global ~/.deskwand/AGENTS.md first via agentsFilesOverride", async () => {
    fs.writeFileSync(
      path.join(ctx!.dir, "AGENTS.md"),
      "# project rules",
      "utf-8",
    );
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "global-md-home-"));
    fs.mkdirSync(path.join(fakeHome, ".deskwand"), { recursive: true });
    fs.writeFileSync(
      path.join(fakeHome, ".deskwand", "AGENTS.md"),
      "# global rules",
      "utf-8",
    );
    state.mockHome = fakeHome;
    const host = PiExtensionHost.getOrCreate({
      cwd: ctx!.dir,
      agentDir: ctx!.agentDir,
    });
    try {
      await host.reloadResources();
      const loader = await host.createSessionResourceLoader([]);
      const files = loader.getAgentsFiles().agentsFiles;
      expect(files[0].path).toBe(path.join(fakeHome, ".deskwand", "AGENTS.md"));
      expect(files[0].content).toContain("global rules");
      expect(files.map((f) => f.path)).toContain(
        path.join(ctx!.dir, "AGENTS.md"),
      );
    } finally {
      state.mockHome = "";
      host.dispose();
    }
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
    const tools = host
      .getExtensionsResult()
      .extensions.flatMap((e) => [...e.tools.keys()]);
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
    const tools = host
      .getExtensionsResult()
      .extensions.flatMap((e) => [...e.tools.keys()]);
    expect(tools).toContain("proj_secret_tool");
    host.dispose();
  });
});

describe("PiExtensionHost packaged layout aliases", () => {
  // 回归：SDK getAliases patch（topLevelNodeModules）不能破坏 dev 嵌套布局解析。
  // 通过真实 SDK jiti 加载一个 import @earendil-works/pi-agent-core 的扩展验证。
  it("loads extension importing pi-agent-core via nested layout (dev regression)", async () => {
    const ctx = makeTempProject();
    fs.writeFileSync(
      path.join(ctx.agentDir, "extensions", "uses-core.ts"),
      `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-agent-core";
export default function (pi: ExtensionAPI) {
  pi.registerTool({ name: "core_user_tool", label: "x", description: "x",
    parameters: {} as any,
    execute: async () => ({ content: [{ type: "text", text: "x" }], details: {} }) });
}`,
    );
    const host = PiExtensionHost.getOrCreate({
      cwd: ctx.dir,
      agentDir: ctx.agentDir,
    });
    await host.reloadResources();
    const errors = host.getExtensionErrors();
    expect(errors).toEqual([]);
    const tools = host
      .getExtensionsResult()
      .extensions.flatMap((e) => [...e.tools.keys()]);
    expect(tools).toContain("core_user_tool");
    host.dispose();
  });
});
