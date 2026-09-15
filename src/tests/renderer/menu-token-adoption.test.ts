/**
 * 弹出菜单统一样式的「账本」测试。
 *
 * token 自己的取值由 menu-styles.test.ts 锁住；这个文件锁的是
 * **每个菜单文件确实用了它** —— 只断言常量本身，改了菜单却不引用 token
 * 测试是不会红的，那正是要防的回退。
 *
 * 这批断言是最好努力的守卫，不是证明：它们能拦住「整块内联样式被写回来」，
 * 拦不住「少写一个 token 但用了别的等价写法」。面板外观的真正判据是人眼 + 两条
 * jsdom 渲染断言（attach-menu / merged-input-chip）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/** 仓库里全部 7 个弹出菜单组件（共 9 个菜单实例）。新增菜单时补进来。 */
const MENU_FILES = [
  "src/renderer/components/attach/AttachMenu.tsx",
  "src/renderer/components/MergedInputChip.tsx",
  "src/renderer/components/SlashMenu.tsx",
  "src/renderer/components/AccountMenu.tsx",
  "src/renderer/components/Sidebar.tsx",
  "src/renderer/components/VaultView.tsx",
  "src/renderer/components/ScheduleEditModal.tsx",
];

const readSource = (relPath: string) =>
  readFileSync(join(process.cwd(), relPath), "utf8");

describe.each(MENU_FILES)("%s", (file) => {
  it("imports the shared menu tokens", () => {
    const source = readSource(file);
    expect(source).toMatch(/from ["'][^"']*menu-styles["']/);
    expect(source).toContain("MENU_PANEL");
  });

  it("has no inline panel shell shadow left", () => {
    // 旧面板外壳的判别特征是它的阴影 token（shadow-soft / shadow-lg）。
    // 两个坑都避开了：
    //  - 不能拿“rounded-* border border-* bg-background”当特征：搜索框这类表单元素
    //    也长那样（MergedInputChip 的模型搜索框），会误报；
    //  - 前面不能是 `-`，否则 `drop-shadow-lg` 也会被当成面板阴影。
    expect(readSource(file)).not.toMatch(/(?<![\w-])shadow-(soft|lg)\b/);
  });

  it("has no inline menu item class left", () => {
    expect(readSource(file)).not.toMatch(/h-9 w-full items-center gap-/);
  });

  it("不再引用已删除的 animate-account-menu-in", () => {
    expect(readSource(file)).not.toContain("animate-account-menu-in");
  });
});
