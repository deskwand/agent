import { describe, expect, it } from "vitest";
import { cn } from "cn";
import { appButtonVariants } from "../src/renderer/components/app-button";
import {
  OPTION_BASE,
  OPTION_IDLE,
  OPTION_SELECTED,
} from "../src/renderer/components/message/AskUserCard";

// ask_user 的选项内容是「标题 + 描述」两段文字，靠 `block` 描述换到第二行、
// 靠自动高度随内容长高。迁到 shadcn 的 `Button` 后，选项按钮继承到 base 的
// `inline-flex items-center whitespace-nowrap` + size 的 `h-9`：
// 两段文字挤成一行、盒子锁死 36px ⇒ 长描述横向溢出，被卡片的 `overflow-hidden`
// 裁掉（用户截图：推荐项描述停在「这块是唯…」）。
//
// 这里锁的不是源码文本，而是 `cn` 合并后的**生效类名** —— 正是它决定了版式：
// 选项按钮必须把这四条 base 契约逐条顶掉。
const optionClasses = (selected: boolean): string =>
  cn(
    appButtonVariants({ variant: "ghost" }),
    "justify-start",
    `${OPTION_BASE} ${selected ? OPTION_SELECTED : OPTION_IDLE}`,
  );

describe("ask_user option button classes vs the shadcn Button base", () => {
  for (const selected of [false, true]) {
    const effective = optionClasses(selected);

    it(`overrides whitespace-nowrap so the description can wrap (selected=${selected})`, () => {
      expect(effective).toContain("whitespace-normal");
      expect(effective).not.toContain("whitespace-nowrap");
    });

    it(`overrides the fixed h-9 so the box grows with the text (selected=${selected})`, () => {
      expect(effective).toContain("h-auto");
      expect(effective).not.toMatch(/(?:^|\s)h-9(?:\s|$)/);
    });

    it(`stacks the label over the description instead of one centred row (selected=${selected})`, () => {
      expect(effective).toContain("flex-col");
      expect(effective).not.toContain("items-center");
      expect(effective).toContain("gap-0");
      expect(effective).not.toContain("gap-2");
    });
  }

  it("keeps the surviving button affordances (width, border, left align)", () => {
    const effective = optionClasses(false);
    expect(effective).toContain("w-full");
    expect(effective).toContain("text-left");
    expect(effective).toContain("justify-start");
    expect(effective).toContain(OPTION_IDLE.split(" ")[0]);
  });
});
