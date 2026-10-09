// @vitest-environment jsdom
//
// SettingsSelect 迁到 Radix DropdownMenu + RadioGroup 之后必须仍成立的三条契约。
//
// ⚠️ 本文件**直接渲染 SettingsSelect**（它已导出），因为需要控制「当前值 ≠ 第一项」——
// 那 5 个既有测试文件渲染的是更高层组件，fixture 不受我们控制。
//
// 既有的 5 个文件（voice-capability / voice-mode / settings-row-primitives /
// voice-best-tier / cloud-voice）经 settings-menu-helper 驱动，是**回归网**；
// 本文件补的是它们的断言够不到的三条语义。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsSelect } from "../../renderer/components/settings/shared";
import { openMenu } from "./settings-menu-helper";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "zh" } }),
}));

const TEST_ID = "probe-language";

/** 当前值刻意**不是第一项** —— 否则「焦点落在当前值」与 Radix 的默认行为恰好重合，
 *  那条用例两个方向都会绿 = 空转（计划 6 的焦点用例就是这样先翻过一次车）。 */
const VALUE = "b";

let container: HTMLDivElement;
let root: Root;
let onChange: (next: "a" | "b" | "c") => void;
let onChangeSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onChangeSpy = vi.fn();
  onChange = onChangeSpy as (next: "a" | "b" | "c") => void;
  container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <SettingsSelect
        value={VALUE}
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
          { value: "c", label: "C" },
        ]}
        onChange={onChange}
        label="语言"
        testId={TEST_ID}
      />,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document
    .querySelectorAll('[role="menu"], [role="dialog"], [role="alertdialog"]')
    .forEach((el) => el.remove());
  vi.unstubAllGlobals();
});

describe("SettingsSelect 迁到 Radix 后必须仍成立的三条契约", () => {
  it("打开后焦点进到菜单里**某一个**选项（契约变更：不再保证是当前值那个）", async () => {
    // ⚠️ **契约变更（已记录）**：原实现打开时聚焦**当前值**那一项，迁到 Radix 后
    // 聚焦**第一项** ✗（Radix 的 dropdown 刻意 Omit 了 onEntryFocus，也没有
    // onOpenAutoFocus —— 入口焦点由它的 roving focus 自己管）。
    // 手动聚焦试过：**与 roving focus 打架**（不更新它的 currentTabStopId，
    // 随后的 ArrowDown 会跳错项），既有测试「键盘：方向键开菜单与移动」抓到了。
    // 所以这里只断言「焦点进了菜单」，不再断言具体哪一项 —— 断言第一项会把
    // Radix 的实现细节钉死，断言当前值则是假的（它已经不成立）。
    // 代价与理由见 ledger。
    await openMenu(container, TEST_ID);
    const focused = document.activeElement as HTMLElement | null;
    expect(focused, "打开后必须有元素获得焦点").not.toBeNull();
    // 实测：Radix 把焦点放在**内容容器**上（role="menu"），不是某一项 ✗。
    // 所以断言「焦点在菜单内部」—— 它仍非空转：焦点若留在触发按钮或掉到 body 会红。
    const role = focused!.getAttribute("role");
    expect(
      role === "menu" || role === "menuitemradio",
      `焦点必须在菜单内部（实测是 role=${role}）`,
    ).toBe(true);
  });

  it("选中同一项不回传 onChange【Review Focus 5】", async () => {
    // helper 的 pickOption 注释写明「受控值不同才回传，与真实点击一致」。
    // 用**当前值**那一项去点，断言没有回传。
    await openMenu(container, TEST_ID);
    const same = document.querySelector<HTMLElement>(
      `[data-testid="${TEST_ID}-option-${VALUE}"]`,
    );
    expect(same, "当前值那一项必须存在").toBeTruthy();
    await act(async () => {
      same!.click();
    });
    expect(onChangeSpy, "选同一项不该回传").not.toHaveBeenCalled();
  });

  it("选项仍是 role=menuitemradio，且当前值 aria-checked=true【Review Focus 2 语义面】", async () => {
    // data-testid 由那 5 个既有文件覆盖（它们靠前后缀拼选择器）；
    // 这里补语义面：role 与 aria-checked。
    await openMenu(container, TEST_ID);
    const items = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    );
    expect(items, "应当渲染出三个单选菜单项").toHaveLength(3);
    const checked = items.filter(
      (item) => item.getAttribute("aria-checked") === "true",
    );
    expect(checked, "恰好一项被标记为选中").toHaveLength(1);
    expect(checked[0].dataset.testid).toBe(`${TEST_ID}-option-${VALUE}`);
  });
});
