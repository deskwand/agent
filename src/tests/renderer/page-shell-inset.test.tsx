// @vitest-environment jsdom
//
// rail 七个独立页面的**页面级**水平内边距只有一个真源。
//
// 起因（2026-10-11 审计）：七个页面各写各的内边距，出现 16 / 20 / 24 / 32 四种值；
// 自动化页一页之内还有三个左边缘（页头 32 / 工具栏 12 / 日历 0）。本文件把「值」钉在
// page-styles 的常量上：页面外壳必须引用它，旧字面量一处不剩。
//
// 只钉这一个值不是疏漏：页根类名 / 页头形状 / 内容上限 / 返回键类名都只有一两处用，
// 或者今天本来就一致 —— 抽常量是零收益的文本归一（2026-10-11 评审，见设计文档 §4.1）。
//
// 自动化页那两条用例断言的是**结构**（谁和谁同一条基线），不是类名字符串：页头里返回键
// 与 h1 必须同行、内边距盒必须唯一且三个子区间共用它。改样式时它们不会假红。
//
// 面板内部的局部内边距（阅读栏、卡片、表格单元格、按钮自身）**不归**这里管。
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "../../renderer/i18n/config";
import { PAGE_INSET_X } from "../../renderer/components/page-styles";
import { ScheduleView } from "../../renderer/components/ScheduleView";
import { useAppStore } from "../../renderer/store";
import { RENDERER } from "./theme-css-helpers";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const read = (rel: string) => fs.readFileSync(path.join(RENDERER, rel), "utf8");

describe("页面级水平内边距的唯一真源", () => {
  it("常量就是 20px 那一档（值被改动时当场红）", () => {
    // Tailwind 的 5 = 1.25rem = 20px @ 默认根字号。改这里等于改全站页面内边距，
    // 所以钉死；要改就一并更新设计文档的审计表。
    expect(PAGE_INSET_X).toBe("px-5");
  });
});

describe("自动化页：三条边缘收敛成一条", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState(useAppStore.getInitialState(), true);
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  async function mountSchedule(): Promise<HTMLElement> {
    await act(async () => {
      root = createRoot(container);
      root.render(<ScheduleView />);
    });
    return container.firstElementChild as HTMLElement;
  }

  /** token 级内边距判定（不是子串）：`lg:px-5` 这种也要红。 */
  const insetToken = new RegExp(`(^|\\s)${PAGE_INSET_X}(\\s|$)`);

  it("页头 / 工具栏 / 日历装在同一个内边距盒里，整页铺满（不设宽度上限）", async () => {
    const rootEl = await mountSchedule();
    // 编辑弹窗关闭时 onRestoreFocus 要落回这个节点（ScheduleEditModal 的调用点）
    expect(rootEl.getAttribute("tabindex")).toBe("-1");

    // 页面级内边距只在一处给出（唯一真源）。这同时保证三条左边缘同在基线上。
    const boxes = Array.from(
      container.querySelectorAll<HTMLElement>("*"),
    ).filter((el) => insetToken.test(el.getAttribute("class") ?? ""));
    expect(boxes, "页面级内边距应当只在一处给出").toHaveLength(1);
    const box = boxes[0];
    // 与其他六页一致：铺满主区，不设宽度上限（2026-10-11 截图对照后定的）
    expect(box.getAttribute("class"), "自动化页不该有宽度上限").not.toContain(
      "max-w-",
    );

    const regions = Array.from(box.children) as HTMLElement[];
    expect(regions, "页头 / 工具栏 / 日历容器").toHaveLength(3);
    for (const region of regions) {
      // 谁也不得再带一次水平内边距：叠出两倍，或（工具栏底色带）比下方网格宽出 20px
      // —— 2026-10-11 截图报障就是后者。
      expect(region.getAttribute("class")).not.toMatch(/(^|\s)p(?:x|l|r)?-/);
      // 也不得自带宽度：`w-*`/`max-w-*` 会让该区脱离共同的盒，同样把带子或网格拉宽
      expect(region.getAttribute("class")).not.toMatch(
        /(^|\s)(?:w|max-w|min-w)-/,
      );
    }
    // 日历确实在这个盒里（默认周视图的整点标尺；该轨渲染 01:00–23:00，没有 00:00）
    expect(regions[2].textContent).toContain("12:00");
  });

  it("页头对齐其余六页：返回键与 h1 同行、无 DESKWAND 抬头、不再有 h2", async () => {
    await mountSchedule();
    const header = container.querySelector("header");
    expect(header, "页头应是 <header>").not.toBeNull();
    // 页头不带自己的内边距：左基线由父层的内边距盒给出，才与网格、工具栏带同一个盒
    expect(header!.getAttribute("class")).not.toMatch(/(^|\s)p(?:x|l|r)?-/);

    const back = header!.querySelector("button");
    expect(back?.getAttribute("aria-label")).toBe(i18n.t("common.back"));
    const title = header!.querySelector("h1");
    expect(title?.textContent).toBe(i18n.t("sidebar.automation"));
    expect(header!.textContent).toContain(i18n.t("schedule.viewDesc"));

    // 同一行：返回键与标题同在页头的第一个子容器里（返回键独占一行时这条会红）
    const row = header!.firstElementChild;
    expect(row?.contains(back!)).toBe(true);
    expect(row?.contains(title!)).toBe(true);

    expect(header!.textContent).not.toContain("DeskWand");
    // 标题不再用 h2（只看页头：弹窗/其他区将来出现 h2 不该让这里假红）
    expect(header!.querySelector("h2"), "页标题不再用 h2").toBeNull();
  });
});

/** rail 七个页面的外壳文件（界面多分支的算两个：聊天空态、动态列表行）。
 *  自动化工具栏不在此列：它的左右内边距来自 ScheduleView 的内边距盒，自己带一次会让
 *  底色带比网格宽（2026-10-11 截图报障）。 */
const PAGE_SHELLS: Record<string, string> = {
  聊天: "components/ChatView.tsx",
  聊天空态: "components/WelcomeView.tsx",
  灵感: "components/IdeasView.tsx",
  动态: "components/FeedView.tsx",
  动态列表行: "components/FeedItemRow.tsx",
  自动化: "components/ScheduleView.tsx",
  连接: "components/connectors/ConnectorsView.tsx",
  密库: "components/VaultView.tsx",
  用量统计: "components/UsageView.tsx",
  反馈: "components/feedback/FeedbackList.tsx",
};

describe("各页外壳都从共享常量取内边距", () => {
  it("十个外壳文件都把常量嵌进 className（不是只提一下名字）", () => {
    for (const [name, file] of Object.entries(PAGE_SHELLS)) {
      // 要的是 `${PAGE_INSET_X}` 这种模板串用法：注释里提一句名字不算
      expect(read(file), `${name}（${file}）没有把常量嵌进类串`).toContain(
        "${PAGE_INSET_X}",
      );
    }
  });

  it("审计出的旧字面量一处不剩", () => {
    const banned: Array<[string, string]> = [
      ["components/ChatView.tsx", "lg:px-8"],
      ["components/ChatView.tsx", "max-w-[920px]"],
      ["components/WelcomeView.tsx", "md:px-8"],
      ["components/WelcomeView.tsx", "max-w-[840px]"],
      ["components/IdeasView.tsx", "w-[322px]"],
      ["components/ScheduleView.tsx", "lg:px-8"],
      ["components/VaultView.tsx", "px-6 py-5"],
      ["components/UsageView.tsx", "px-6 py-5"],
      ["components/FeedItemRow.tsx", "px-4"],
    ];
    for (const [file, literal] of banned) {
      expect(read(file), `${file} 仍残留 ${literal}`).not.toContain(literal);
    }
  });

  it("动态页只剩两处局部的旧值：空态引导块与主按钮自身", () => {
    const feed = read("components/FeedView.tsx");
    // 页级横条（页头 ×2 / 报错条 / 失败条 ×2 / 搜索筛选行 / 分组标题 / 播放条）与列表行
    // 全部迁到 PAGE_INSET_X；剩下这两处是刻意保留的（见设计文档 §4.5 例外表）。
    expect(feed.match(/px-4/g) ?? [], "只允许按钮那一处 px-4").toHaveLength(1);
    expect(
      feed.match(/px-6/g) ?? [],
      "只允许空态引导块那一处 px-6",
    ).toHaveLength(1);
  });
});
