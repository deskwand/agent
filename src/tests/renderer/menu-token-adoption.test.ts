/**
 * 弹出菜单统一样式的「账本」测试。
 *
 * token 自己的取值由 menu-styles.test.ts 锁住；这个文件锁的是
 * **每个菜单文件确实用了它** —— 只断言常量本身，改了菜单却不引用 token
 * 测试是不会红的，那正是要防的回退。
 *
 * 这批断言是最好努力的守卫，不是证明：它们能拦住「整块内联样式被写回来」，
 * 拦不住「少写一个 token 但用了别的等价写法」。面板外观的真正判据是人眼 + 三条
 * jsdom 渲染断言（attach-menu / merged-input-chip / status-popover）。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect } from "vitest";

/** 仓库里全部 9 个弹出菜单/浮层组件。新增菜单时补进来。 */
const MENU_FILES = [
  "src/renderer/components/attach/AttachMenu.tsx",
  "src/renderer/components/usage/CurrencySelect.tsx",
  "src/renderer/components/MergedInputChip.tsx",
  "src/renderer/components/SlashMenu.tsx",
  "src/renderer/components/AccountMenu.tsx",
  "src/renderer/components/Sidebar.tsx",
  "src/renderer/components/VaultView.tsx",
  "src/renderer/components/ScheduleEditModal.tsx",
  "src/renderer/components/StatusPopover.tsx",
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

  it("has an entrance animation", () => {
    // 统一文档：按弹出方向二选一。缺了它，浮层会硬弹出来。
    // 已核：既有 7 个文件全部含 animate-menu-in-*，所以这条不会误伤。
    expect(readSource(file)).toMatch(/animate-menu-in-(up|down)/);
  });
});

it("registers every component that uses the shared panel shell", () => {
  const users: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith(".tsx")) {
        if (readFileSync(abs, "utf8").includes("MENU_PANEL")) {
          // 路径口径：cwd 相对、用 `/` 分隔（与 MENU_FILES 逐项一致）。
          // POSIX 假设：Windows 上 relative() 给反斜杠会让比较整体误报。本仓测试只在 macOS 跑，
          // 且同类假设在仓库里已有先例（title-attrs-migration.test.ts 也是把 path.relative
          // 的产物直接对比带 `/` 的字面量），所以跟随房子写法，不在这里加平台特判。
          //
          // ⚠️ 已知盲区：判据是「文件文本含 `MENU_PANEL`」。若将来有人通过再导出的别名
          // （如 SlashMenu.tsx:61 的 `SLASH_MENU_CONTAINER_CLASS`）间接用外壳，该文件不含这个
          // 字面量 → 不进 users → 不必登记 → 复刻「用了外壳却没护栏」的形态。今天无此类消费者。
          // 真出现时把判据换成「import 自 menu-styles」前，先确认不会误伤只用 MENU_ITEM_CLASS
          // 的非浮层文件。
          users.push(relative(process.cwd(), abs));
        }
      }
    }
  };
  walk(join(process.cwd(), "src/renderer"));

  // 非空校验：这一条同时证明「walk 扫到了东西」与「路径书写口径对」——
  // 若 walk 失效（扫到 0 个）或产出 `components/X.tsx` 这种 RENDERER 相对路径，
  // 它就红，而不是让下面的比较在空集合上「全部通过」。
  // 刻意**不写** `users.length >= N`：那个 N 在任务中会变（登记前 7、改完 8），
  // 很容易写成与当前执行点不自洽的魔数。
  expect(users).toContain("src/renderer/components/MergedInputChip.tsx");

  // 失败信息会直接列出「用了外壳却没登记」的文件，修法就是加进 MENU_FILES。
  expect(users.filter((file) => !MENU_FILES.includes(file))).toEqual([]);
});
