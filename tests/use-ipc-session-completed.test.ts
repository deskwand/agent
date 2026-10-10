import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const useIPCPath = path.resolve(process.cwd(), "src/renderer/hooks/useIPC.ts");

describe("useIPC session completion", () => {
  it("setSessionCompleted 只合 completedAt，并把事件发出去", () => {
    const source = fs.readFileSync(useIPCPath, "utf8");

    const start = source.indexOf("const setSessionCompleted = useCallback(");
    expect(start).toBeGreaterThan(-1);
    // 这个文件里 callback 的收尾是 `[send],` 换行 + `);`（prettier 排的），不是
    // 单行 `}, [send],);` —— 按单行找会 indexOf 返回 -1、切块变成整段文件。
    const end = source.indexOf("\n    [send],\n  );", start);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);

    expect(block).toContain('type: "session.setCompleted"');
    expect(block).toContain("payload: { sessionId, completed }");
    expect(block).toContain("completedAt: completed ? Date.now() : undefined");
    // 乐观更新只能合 completedAt：带上 updatedAt 就会把会话顶到列表最前。
    // 先剥掉注释行再断言 —— 上面那句解释里就写着 "updatedAt" 这个词。
    const code = block
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toContain("updatedAt");
    // 必须在 useIPC 的返回对象里，否则 Sidebar 解构到 undefined
    expect(source).toMatch(/\n\s+setSessionCompleted,/);
  });
});
