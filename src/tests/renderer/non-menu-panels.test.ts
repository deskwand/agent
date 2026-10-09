// @vitest-environment jsdom
//
// 另外三个「看着像菜单、其实不是」的浮层，用证据钉住它们的判定。
//
// 为什么要写成测试而不是只写进 ledger：ledger 是 gitignored 的、下个计划不一定读 ✗。
// 真能拦住「未来的计划把它们硬塞进菜单族」的只有一条守卫测试。
//
// ⚠️ 已知盲区：这是**文本扫描**，不是语义分析。能绕过它的写法包括从
// `@radix-ui/react-dropdown-menu` 直接 import、本地包一层转出、或写 `role={"menu"}`。
// 它防的是「照着本仓既有写法顺手用 `ui/dropdown-menu`」这种最可能发生的失误。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const COMPONENTS = "src/renderer/components/";

describe("这几个浮层不是菜单族的成员", () => {
  it("MergedInputChip 不用 DropdownMenu（面板里有搜索框，Radix 的菜单撑不住）", () => {
    // 它是 Combobox 形状：`modelSearch` 搜索框 + `panelView` 两个视图（列表/思考）
    // + 量出的 `panelMaxHeight`。Radix 的菜单键盘模型假定「内容全是 item」，
    // 面板里的搜索框拿不到焦点 ✗。Radix 也没有 Combobox 原语，
    // 按设计文档 D1「shadcn 没有的才自己来」属「自己来」那一类。
    const source = read(`${COMPONENTS}MergedInputChip.tsx`);
    expect(source).not.toContain("ui/dropdown-menu");
    expect(source).not.toContain("<DropdownMenu");
    expect(source).not.toContain("DropdownMenuContent");
  });

  it("ChatInputStatusBar 与 ScheduleEditModal 也还没归入菜单族", () => {
    // 两者都没有 role="menu" —— 它们是浮层/列表，不是菜单。
    // 这条不是「它们永远不许用菜单」，而是：**换实现之前先回来重新判断形状**
    //（ChatInputStatusBar 偏 Popover；ScheduleEditModal 偏 listbox）。
    // 若哪天它们真的要变成菜单，请连同上面那条一起改写并说明理由。
    //
    // ⚠️ 判据与上面那条**同样查三样**（不是只查 `<DropdownMenu`）：只查元素名的话，
    // 「import 了但还没用」「用了 DropdownMenuContent」都能溜过去。
    for (const file of ["ChatInputStatusBar.tsx", "ScheduleEditModal.tsx"]) {
      const source = read(`${COMPONENTS}${file}`);
      expect(source).not.toContain("ui/dropdown-menu");
      expect(source).not.toContain("<DropdownMenu");
      expect(source).not.toContain("DropdownMenuContent");
    }
  });
});
