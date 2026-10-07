import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readAgentRunner(): string {
  return readFileSync(
    path.resolve(process.cwd(), "src/main/agent/agent-runner.ts"),
    "utf8",
  );
}

/**
 * 单通道不变量：助手正文里的围栏必须原样传到渲染层。
 *
 * 围栏里带着产物的路径，渲染层要靠它在**原文中的位置**拆成产物块；
 * 主进程如果先把围栏剥掉，产物就只能靠另一条通道（trace step）回到界面，
 * 两条通道的时间差会让"文件卡里的文件名列表"先出现再被替换。
 *
 * 历史路径（entries-to-messages → 渲染层）本来就保留围栏，这条测试守的是实时路径。
 */
describe("artifact 围栏的传递（单通道）", () => {
  it("不再把剥掉围栏的文本发给渲染层", () => {
    expect(readAgentRunner()).not.toContain("sanitizeOutputPaths(cleanText)");
  });

  it("仍然为右侧产物面板发 trace step", () => {
    const source = readAgentRunner();
    expect(source).toContain("extractArtifactsFromText(");
    expect(source).toContain("buildArtifactTraceSteps(");
  });
});
