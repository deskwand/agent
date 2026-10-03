/**
 * 把 codemode 外层块的标准化嵌套调用快照投影成可渲染的虚拟工具块。
 *
 * 纯函数：不修改入参、不写 store、不合成消息。普通块按原引用透传；
 * 外层脚本块在有子调用记录时被虚拟子块替换，没有记录时保留为脚本兜底。
 *
 * 约束：
 *  - 最终明细优先于运行时快照（final 记录胜出），运行时 outputs 只提供
 *    正文/diff/图片，绝不回填被省略的子调用参数；
 *  - source 为 missing 时保留已观察到的调用供详情展示；
 *  - 同一个块列表重复投影结果不变（幂等）；
 *  - 同一轮尚未落入当前切片的外层结果可通过 lookupBlocks 显式传入。
 */
import type {
  ContentBlock,
  Message,
  ToolResultContent,
  ToolUseContent,
} from "../types";
import type {
  NestedToolCallsUi,
  NestedToolRuntimeUi,
} from "../../shared/nested-tool-calls";

function isCodemode(block: ContentBlock): block is ToolUseContent {
  return (
    block.type === "tool_use" &&
    block.name.toLowerCase() === "codemode" &&
    !block.trace
  );
}

export function projectNestedToolBlocks(
  blocks: ContentBlock[],
  runtimes: Record<string, NestedToolRuntimeUi>,
  active: boolean,
  lookupBlocks: ContentBlock[] = blocks,
): ContentBlock[] {
  const parentIds = new Set(
    lookupBlocks.filter(isCodemode).map((block) => block.id),
  );
  const resultById = new Map<string, ToolResultContent>();
  for (const block of lookupBlocks) {
    if (block.type === "tool_result") resultById.set(block.toolUseId, block);
  }

  const out: ContentBlock[] = [];
  for (const block of blocks) {
    // 外层脚本结果只作为明细来源；有子调用时由虚拟子块替代展示。
    if (block.type === "tool_result" && parentIds.has(block.toolUseId))
      continue;
    if (!isCodemode(block)) {
      out.push(block);
      continue;
    }

    const result = resultById.get(block.id);
    const runtime = runtimes[block.id];
    const snapshot: NestedToolCallsUi = result?.nestedCalls ??
      runtime?.snapshot ?? {
        parentToolCallId: block.id,
        calls: [],
        complete: false,
        parentStatus:
          active && !result
            ? "running"
            : result?.isError
              ? "error"
              : result
                ? "ok"
                : "unfinished",
        source: "missing",
      };

    if (snapshot.calls.length === 0) {
      out.push({
        ...block,
        trace: {
          parentToolCallId: block.id,
          status: snapshot.parentStatus,
          parentStatus: snapshot.parentStatus,
          complete: snapshot.complete,
          source: snapshot.source,
          script: { id: block.id, input: block.input },
        },
      });
      if (result) out.push(result);
      continue;
    }

    for (const [index, call] of snapshot.calls.entries()) {
      const output = runtime?.outputs[call.id];
      out.push({
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: call.input ?? {},
        trace: {
          parentToolCallId: block.id,
          status: call.status,
          parentStatus: snapshot.parentStatus,
          complete: snapshot.complete,
          source: snapshot.source,
          argumentsBytes: call.argumentsBytes,
          cancelled: call.cancelled,
          ...(index === 0
            ? { script: { id: block.id, input: block.input } }
            : {}),
        },
      });
      if (call.status !== "running" || output) {
        out.push({
          type: "tool_result",
          toolUseId: call.id,
          status: call.status,
          content: output?.content ?? call.error ?? "",
          isError: call.status === "error",
          outputUnavailable: !output,
          ...(output?.diff ? { diff: output.diff } : {}),
          ...(output?.images ? { images: output.images } : {}),
        });
      }
    }
  }
  return out;
}

export function projectNestedToolMessages(
  messages: Message[],
  runtimes: Record<string, NestedToolRuntimeUi>,
  activeTurnId?: string,
): Message[] {
  const turns = new Map<string, ContentBlock[]>();
  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content))
      continue;
    const key = message.turnId ?? message.id;
    turns.set(key, [...(turns.get(key) ?? []), ...message.content]);
  }
  return messages
    .map((message) => {
      if (message.role !== "assistant" || !Array.isArray(message.content))
        return message;
      return {
        ...message,
        content: projectNestedToolBlocks(
          message.content,
          runtimes,
          Boolean(activeTurnId) && message.turnId === activeTurnId,
          turns.get(message.turnId ?? message.id) ?? message.content,
        ),
      };
    })
    .filter(
      (message) =>
        message.role !== "assistant" ||
        !Array.isArray(message.content) ||
        message.content.length > 0,
    );
}
