import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "@sinclair/typebox";
import {
  createAgentSession,
  defineTool,
} from "@earendil-works/pi-coding-agent";

/**
 * A1 押在一条 SDK 语义上：`customTools` 里 `exposure: "codemode"` 的工具
 * ①不声明给模型（不在 active）②仍在可调用集合（codemode 能调到）。
 *
 * 这条语义由 pi 提供、不由我们提供 —— 所以单独钉一次：升级 pi 时若语义变了，这里先红，
 * 而不是线上静默失效（19 个工具悄悄回到提示里，或者悄悄变得不可调用）。
 */
const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "a1-sdk-contract-"));
const savedPackageDir = process.env.PI_PACKAGE_DIR;
const savedAgentDir = process.env.PI_CODING_AGENT_DIR;

beforeAll(() => {
  process.env.PI_PACKAGE_DIR = "";
  process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterAll(() => {
  fs.rmSync(agentDir, { recursive: true, force: true });
  if (savedPackageDir === undefined) delete process.env.PI_PACKAGE_DIR;
  else process.env.PI_PACKAGE_DIR = savedPackageDir;
  if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
});

describe("SDK exposure 契约", () => {
  it("codemode 暴露的工具不在 active、但在 callable；direct 工具在 active", async () => {
    // 用 SDK 自己的 defineTool + TypeBox 造桩：类型天然对得上，不需要强转。
    const stub = (name: string, exposure: "codemode" | undefined) =>
      defineTool({
        name,
        label: name,
        description: `${name} stub`,
        parameters: Type.Object({}),
        ...(exposure ? { exposure } : {}),
        async execute() {
          return {
            content: [{ type: "text" as const, text: `${name} ran` }],
            details: undefined,
          };
        },
      });

    const { session } = await createAgentSession({
      cwd: process.cwd(),
      customTools: [
        stub("a1_direct_stub", undefined),
        stub("a1_codemode_stub", "codemode"),
      ],
    });

    const active = session.getActiveToolNames();
    const callable = session.getCallableToolNames();

    expect(active).toContain("a1_direct_stub");
    expect(active).not.toContain("a1_codemode_stub");
    expect(callable).toContain("a1_codemode_stub");

    await session.dispose?.();
  });
});
