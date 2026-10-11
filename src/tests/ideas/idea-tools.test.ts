import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IdeaStore } from "../../main/ideas/idea-store";
import { IdeaService } from "../../main/ideas/idea-service";
import { createIdeaTools } from "../../main/ideas/idea-tools";
import { IdeasExtension } from "../../main/ideas/ideas-extension";

let root: string;
let service: IdeaService;
let tools: ReturnType<typeof createIdeaTools>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ideas-tools-"));
  service = new IdeaService(new IdeaStore(root));
  tools = createIdeaTools(service);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

/**
 * 跑一个工具。`execute` 的类型要 5 个参数（toolCallId / params / signal /
 * onUpdate / ctx），测试只关心前两个，剩下的在适配层一次性补掉。
 */
function run(name: string, params: unknown, callId = "call-1") {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`缺少工具 ${name}`);
  return tool.execute(callId, params, undefined, undefined, undefined as never);
}

/** 工具返回 `{ content: [{ type: "text", text }] }`（照 memory-tools 的写法）。 */
function textOf(result: unknown): string {
  const blocks = (result as { content: { type: string; text: string }[] })
    .content;
  return blocks.map((block) => block.text).join("");
}

describe("工具面", () => {
  it("只给三个：search / read / add", () => {
    expect(tools.map((t) => t.name).sort()).toEqual([
      "idea_add",
      "idea_read",
      "idea_search",
    ]);
  });

  it("没有状态变更与删除工具", () => {
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("idea_set_status");
    expect(names).not.toContain("idea_delete");
  });
});

describe("行为", () => {
  it("idea_add 落盘，能被 search 找到", async () => {
    await run("idea_add", {
      content: "密库注册 ideas 是兼容事件",
    });
    const found = await run("idea_search", {
      query: "兼容",
    });
    expect(textOf(found)).toContain("兼容事件");
  });

  it("idea_search 不传 query 时列出收件箱", async () => {
    await run("idea_add", { content: "第一条" });
    const found = await run("idea_search", {});
    expect(textOf(found)).toContain("第一条");
  });

  it("idea_search 按状态过滤", async () => {
    const created = await run("idea_add", {
      content: "已归档的",
    });
    const name = JSON.parse(textOf(created)).name as string;
    await service.setStatus(name, "archived");

    const inbox = await run("idea_search", {
      status: "inbox",
    });
    expect(textOf(inbox)).not.toContain("已归档的");

    const archived = await run("idea_search", {
      status: "archived",
    });
    expect(textOf(archived)).toContain("已归档的");
  });

  it("idea_read 返回全文", async () => {
    const created = await run("idea_add", {
      content: "正文全文",
    });
    const name = JSON.parse(textOf(created)).name as string;
    const result = await run("idea_read", { name });
    expect(textOf(result)).toContain("正文全文");
  });
});

describe("扩展注入", () => {
  it("只注入 customTools，不加系统提示", async () => {
    const extension = new IdeasExtension(service);
    const result = await extension.beforeSessionRun({
      session: { cwd: "/tmp" },
    } as never);

    expect(result?.customTools).toHaveLength(3);
    // 不给系统提示加任何东西 —— 提示词缓存不受本功能影响。
    expect(result?.systemPromptSuffix).toBeUndefined();
  });
});

describe("暴露层", () => {
  it("三个工具都降到 codemode 层：不在提示里声明，仍可从脚本调用", () => {
    for (const tool of tools) expect(tool.exposure).toBe("codemode");
  });
});
