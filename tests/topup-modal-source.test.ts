import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const modalPath = path.resolve(
  process.cwd(),
  "src/renderer/components/TopUpModal.tsx",
);
const appPath = path.resolve(process.cwd(), "src/renderer/App.tsx");

describe("TopUpModal wiring", () => {
  it("implements the four-step state machine", () => {
    const source = fs.readFileSync(modalPath, "utf8");
    expect(source).toContain('"amount"');
    expect(source).toContain('"chain"');
    expect(source).toContain('"pay"');
    expect(source).toContain('"waiting"');
    expect(source).toContain("waitForOrderConfirmation");
  });

  it("uses i18n keys and semantic tokens only", () => {
    const source = fs.readFileSync(modalPath, "utf8");
    expect(source).toContain("topUp.title");
    // 皮肤类不再手写：计划 13 把页签交给 ui/tabs.tsx（shadcn 默认皮肤），
    // 所以这里钉的语义 token 改为文件里真正承担颜色的那些。
    expect(source).toContain("text-foreground");
    expect(source).toContain("text-muted-foreground");
    expect(source, "不得硬编码色值").not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("is mounted in App", () => {
    const source = fs.readFileSync(appPath, "utf8");
    // 计划 13 Task2 起 App 给它接了 onRestoreFocus（关闭回不到原入口时聚焦 <main>），
    // 所以不能再钉自闭合形态；意图是「App 真的挂载了它」。
    expect(source).toContain("<TopUpModal");
  });
});
