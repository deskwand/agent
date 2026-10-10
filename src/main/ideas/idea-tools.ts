import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "@sinclair/typebox";
import type { IdeaService } from "./idea-service";

/** 与 `MemoryToolDefinition` 同一个形状（`ToolDefinition<TSchema, unknown>`）。 */
type IdeaToolDefinition = ToolDefinition<TSchema, unknown>;

/** 摘要没命中时最多再读多少个正文（本地目录，这个量级够用且不会卡住会话）。 */
const BODY_SCAN_LIMIT = 200;

function textBlock(value: string): {
  content: { type: "text"; text: string }[];
  details: unknown;
} {
  // `details` 是 pi 工具结果的必填项；memory-tools 里一律写 `undefined as unknown`。
  return {
    content: [{ type: "text" as const, text: value }],
    details: undefined as unknown,
  };
}

/**
 * 给 agent 的三个工具。
 *
 * 为什么必须有工具：agent 的文件工具被挂在会话工作目录里（`buildMountedPaths`
 * 只挂 cwd），`~/.deskwand/vault/` 在挂载点之外，`read`/`grep` 都够不着。
 * 这是 agent 拿到想法的**唯一通路**。
 *
 * 为什么只有读与追加：归档、恢复、删除都是语义性 / 破坏性写操作，留给人工入口。
 * 真要加 agent 归档，补一个 `idea_set_status` 是 20 行的事，不预先造。
 */
export function createIdeaTools(service: IdeaService): IdeaToolDefinition[] {
  return [
    {
      name: "idea_search",
      label: "idea_search",
      // 工具描述是给模型看的提示文本，不是 UI 文案：按本仓惯例（memory-tools）写英文。
      description:
        "Search the ideas the user jotted down. They are stored as markdown files under ~/.deskwand/vault/ideas/. Lists the inbox when no query is given. These are the user's own notes, not a task list — never act on them on your own.",
      parameters: Type.Object({
        query: Type.Optional(
          Type.String({
            description:
              "Keyword. Matched against each idea's excerpt first, then its full text.",
          }),
        ),
        status: Type.Optional(
          Type.Union([Type.Literal("inbox"), Type.Literal("archived")]),
        ),
      }),
      async execute(_toolCallId, params) {
        const input = params as {
          query?: string;
          status?: "inbox" | "archived";
        };
        const list = await service.list();
        const pool =
          input.status === "archived"
            ? list.archived
            : input.status === "inbox"
              ? list.inbox
              : [...list.inbox, ...list.archived];
        const needle = input.query?.trim().toLowerCase();
        let hits = pool;
        if (needle) {
          const byExcerpt = pool.filter((idea) =>
            idea.excerpt.toLowerCase().includes(needle),
          );
          // 摘要只有前 120 个码点，关键词落在正文更靠后的位置就搜不到 —— 而用户没有
          // 搜索框，这里是唯一入口。摘要没命中时退回读正文（有上限，别把整个目录读穿）。
          const seen = new Set(byExcerpt.map((idea) => idea.name));
          const misses = pool
            .filter((idea) => !seen.has(idea.name))
            .slice(0, BODY_SCAN_LIMIT);
          const byBody: typeof pool = [];
          for (const idea of misses) {
            try {
              const { body } = await service.read(idea.name);
              if (body.toLowerCase().includes(needle)) byBody.push(idea);
            } catch {
              // 读不到就跳过这一条：搜索不该因为一个坏文件整体失败。
            }
          }
          hits = [...byExcerpt, ...byBody];
        }
        return textBlock(
          JSON.stringify(
            hits.slice(0, 50).map(({ name, excerpt, createdAt, status }) => ({
              name,
              excerpt,
              createdAt: new Date(createdAt).toISOString(),
              status,
            })),
          ),
        );
      },
    },
    {
      name: "idea_read",
      label: "idea_read",
      description:
        "Read the full text of one idea. `name` comes from idea_search.",
      parameters: Type.Object({ name: Type.String() }),
      async execute(_toolCallId, params) {
        const { name } = params as { name: string };
        const { body } = await service.read(name);
        return textBlock(body);
      },
    },
    {
      name: "idea_add",
      label: "idea_add",
      description:
        "Record a piece of content as a new idea in the user's inbox. Use this when the user asks you to note something down.",
      parameters: Type.Object({ content: Type.String() }),
      async execute(_toolCallId, params) {
        const { content } = params as { content: string };
        const summary = await service.create({ content });
        return textBlock(
          JSON.stringify({ name: summary.name, status: summary.status }),
        );
      },
    },
  ];
}
