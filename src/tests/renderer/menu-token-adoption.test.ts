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

/** 仓库里全部 12 个弹出菜单/浮层组件。新增菜单时补进来。 */
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
  "src/renderer/components/ChatInputStatusBar.tsx",
  "src/renderer/components/HelpMenu.tsx",
  // 设置项里的下拉换成自绘菜单后也用了共享外壳（原生 select 的展开菜单由系统绘制，
  // 主题跟不了 app）。登记进来才会一并受"不许内联阴影 / 必须有入场动画"那几条检查。
  "src/renderer/components/settings/shared.tsx",
  "src/renderer/components/connectors/ConnectorsView.tsx",
];

const readSource = (relPath: string) =>
  readFileSync(join(process.cwd(), relPath), "utf8");

describe.each(MENU_FILES)("%s", (file) => {
  it("imports the shared menu tokens", () => {
    // 迁移期两种实现并存：未迁的用本仓的共享 token，已迁的用 Radix 的包裹层。
    // 二者都满足这条不变量的**意图** —— 菜单外壳不许手写。
    const source = readSource(file);
    // 外壳来源二选一：本仓的共享 token，或 Radix 的包裹层。
    // 两者都满足这条不变量的**意图** —— 菜单/浮层外壳不许手写。
    // ⚠️ 计划 6 起判据泛化到**任何 Radix 浮层家族**：写死成 dropdown-menu
    // 会让新引入的 Popover 漏网（计划 6 第一次跑就撞上了）。
    expect(source).toMatch(/menu-styles|ui\/(dropdown-menu|popover)/);
    expect(
      source.includes("MENU_PANEL") ||
        /DropdownMenuContent|PopoverContent/.test(source),
      "必须有一个外壳来源（MENU_PANEL / DropdownMenuContent / PopoverContent）",
    ).toBe(true);
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
    const source = readSource(file);
    // 已迁到 Radix 的：入场动画由对应的 vendored 文件提供
    //（data-[state=open]:animate-in），调用点不需要、也不该再写动画类。
    // 所以这里改为**检查提供方确实带了这个类** —— 判据从调用点移到提供方，
    // 强度不减（缺了它浮层还是会硬弹出来）。
    // ⚠️ 计划 6 起覆盖两个家族；将来再加新家族时这里会**响亮地失败**
    //（落到下面的 animate-menu-in-* 分支），而不是静默放过。
    // ⚠️ 判据必须是 **import 语句**，不能是「文件里出现过某个名字」：
    // 评审实测过这个橡皮图章 —— 一个真外壳是 DialogContent 的文件只要**提到**
    // 一次 PopoverContent（哪怕只是 import 了个别的东西），原来的写法就会把
    // 提供方判成 popover.tsx，于是「有入场动画」这条凭空通过。
    const imported = source.match(
      /from ["'][^"']*ui\/(dropdown-menu|popover)["']/,
    )?.[1];
    const radixProvider = imported
      ? `src/renderer/components/ui/${imported}.tsx`
      : null;
    if (radixProvider) {
      expect(
        readFileSync(join(process.cwd(), radixProvider), "utf8"),
        `${radixProvider} 必须提供入场动画`,
      ).toContain("data-[state=open]:animate-in");
      return;
    }
    // 未迁的：统一文档要求按弹出方向二选一
    //
    // ⚠️ 已知盲区（评审指出、**未修**）：上面那个 walk 的外壳探测只看
    // `MENU_PANEL` / `DropdownMenuContent` / `PopoverContent` 三个字面量。
    // 因此（a）用别名 import 或本地转出（如 `export { X as MenuPanel }`）会绕过；
    // （b）一个基于 `ui/dialog` 的浮层根本不会被登记进来。
    // 前者在 menu-styles 时代就存在（见 walk 里那段既有注释），后者由
    // `occlusion-import-seal.test.ts` 覆盖（它管 Dialog/AlertDialog/Sheet）。
    // 要彻底解决得把探测改成「按 import 语句匹配 ui/ 下的浮层模块」，
    // 但那会把所有 dialog 消费者拉进这张**菜单**登记表 —— 属另一个决定。
    expect(source).toMatch(/animate-menu-in-(up|down)/);
  });
});

it("registers every component that uses the shared panel shell", () => {
  const users: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      // 排除 components/ui/：那里放的是 vendored 的**提供方**
      //（dropdown-menu.tsx 自己就含 DropdownMenuContent），它不是消费者，
      // 不该进登记表 —— 登记表要的是「用了外壳的业务组件」。
      else if (
        entry.name.endsWith(".tsx") &&
        !abs.includes("/components/ui/")
      ) {
        const source = readFileSync(abs, "utf8");
        if (
          source.includes("MENU_PANEL") ||
          // 计划 5 起：已迁到 Radix 的菜单用 DropdownMenuContent 作外壳，
          // 它们**仍然要有外壳**，所以仍然该被登记、仍然受上面那几条检查。
          source.includes("DropdownMenuContent")
        ) {
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
