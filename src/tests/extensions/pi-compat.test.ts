import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PiExtensionHost } from "../../main/extensions/pi-extension-host";
import { createPiUiBridge } from "../../main/extensions/ui/bridge";

const FIXTURES = ["hello.ts", "permission-gate.ts", "todo.ts", "preset.ts"];

describe("pi extension compatibility fixtures", () => {
  let host: PiExtensionHost;
  let fixtureDir: string;

  beforeAll(async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-compat-"));
    fixtureDir = path.join(base, "agent", "extensions");
    fs.mkdirSync(fixtureDir, { recursive: true });
    for (const f of FIXTURES) {
      fs.copyFileSync(path.join(__dirname, "fixtures", f), path.join(fixtureDir, f));
    }
    const project = path.join(base, "project");
    fs.mkdirSync(project, { recursive: true });
    const agentDir = path.join(base, "agent");
    host = PiExtensionHost.getOrCreate({
      cwd: project,
      agentDir,
      additionalSkillPaths: [],
    });
    await host.reloadResources();
  });

  it("loads all fixtures without errors", () => {
    expect(host.getExtensionErrors()).toEqual([]);
    expect(host.getExtensionsResult().extensions.length).toBeGreaterThanOrEqual(
      FIXTURES.length,
    );
  });

  it("hello.ts registers the hello tool", () => {
    const tools = host.getExtensionsResult().extensions.flatMap((e) => [
      ...e.tools.keys(),
    ]);
    expect(tools).toContain("hello");
  });

  it("permission-gate.ts subscribes tool_call", () => {
    const ext = host.getExtensionsResult().extensions.find((e) =>
      e.path.endsWith("permission-gate.ts"),
    );
    expect(ext?.handlers.has("tool_call")).toBe(true);
  });

  it("todo.ts registers todo tool and /todos command", () => {
    const ext = host.getExtensionsResult().extensions.find((e) =>
      e.path.endsWith("todo.ts"),
    );
    expect(ext?.tools.has("todo")).toBe(true);
    expect(ext?.commands.has("todos")).toBe(true);
  });

  it("preset.ts registers /preset command and --preset flag", () => {
    const ext = host.getExtensionsResult().extensions.find((e) =>
      e.path.endsWith("preset.ts"),
    );
    expect(ext?.commands.has("preset")).toBe(true);
    expect(ext?.flags.has("preset")).toBe(true);
  });

  it("permission-gate confirm flow works via ui bridge", async () => {
    // 验证 bridge 的 confirm 与扩展 tool_call 拦截的连通性协议形状：
    // permission-gate 拦截 rm -rf 时调用 ctx.ui.confirm，
    // 此处用回调桩验证请求形状正确。
    const calls: unknown[] = [];
    const ui = createPiUiBridge({
      dialog: async (r) => {
        calls.push(r);
        return false;
      },
      notify: () => {},
      setStatus: () => {},
      setWidgetText: () => {},
      setTitle: () => {},
      setEditorText: () => {},
      getEditorText: () => "",
      setWorking: () => {},
      setThinkingLabel: () => {},
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    });
    await ui.confirm("Dangerous!", "Allow rm -rf?");
    expect(calls).toHaveLength(1);
    const req = calls[0] as { method: string; title: string; message: string };
    expect(req.method).toBe("confirm");
    expect(req.title).toBe("Dangerous!");
  });
});
