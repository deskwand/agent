// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (relPath: string) =>
  readFileSync(join(process.cwd(), relPath), "utf8");

const SLASH_MENU = "src/renderer/components/SlashMenu.tsx";

// ⚠️ 已知盲区：这是**文本扫描**，不是语义分析。因此能绕过它的写法包括
// 从 `@radix-ui/react-dropdown-menu` 直接 import、本地包一层转出、
// 或写 `role={"menu"}`（字符串不同）。它防的是「照着本仓既有写法顺手用
// `ui/dropdown-menu`」这种最可能发生的失误 —— 不是恶意规避。
// 真要语义级保证，得渲染并断言焦点行为，那是另一个量级的成本。
describe("SlashMenu 不是菜单族的成员", () => {
  it("不用 DropdownMenu（Radix 的菜单会夺走输入框的焦点）", () => {
    // 它是 Combobox 形状：全宽命令面板 + 键盘导航由外部输入框 ChatInput 拥有
    //（SlashMenu 自己没有任何键盘处理 —— 它唯一的 effect 是「activeTab 没内容时
    // 自动切到 all」）。Radix 明确不提供 Combobox 原语，按设计文档 D1
    // 「shadcn 没有的才自己来」，它属于「自己来」那一类。
    //
    // 硬套 DropdownMenu 会同时坏两件事：
    //   ① 焦点陷阱 + roving focus → 输入框失去焦点，打不了字；
    //   ② 定位模型（锚在 trigger 上）表达不了「与上面那个输入框等宽」。
    const source = readSource(SLASH_MENU);
    expect(source).not.toContain("ui/dropdown-menu");
    expect(source).not.toContain("<DropdownMenu");
    expect(source).not.toContain("DropdownMenuContent");
  });

  it("不带菜单语义（它没有 role=menu）", () => {
    // 与上一条配对：证明「不是菜单」不只是实现选择，也是它现在的语义。
    // 若将来它真变成了菜单，这条会提醒你回来连同上面那条一起重新判断
    //（那时得先解决焦点与定位两个问题）。
    expect(readSource(SLASH_MENU)).not.toContain('role="menu"');
  });
});
