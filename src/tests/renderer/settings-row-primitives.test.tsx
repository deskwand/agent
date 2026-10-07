// @vitest-environment jsdom
import { act, useState, type ReactNode } from "react";
import { menuTrigger, openMenu, pickOption } from "./settings-menu-helper";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SettingsCard,
  SettingsRow,
  SettingsSelect,
  SettingsStatusBadge,
  SettingsSwitch,
} from "../../renderer/components/settings/shared";

let container: HTMLDivElement;
let root: Root;

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

function switchButton(): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>('button[role="switch"]')!;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("设置行原语", () => {
  it("开关把点击翻译成取反后的值，aria-checked 跟着受控值走", async () => {
    const onChange = vi.fn();

    function Harness() {
      const [checked, setChecked] = useState(false);
      return (
        <SettingsSwitch
          checked={checked}
          label="telemetry"
          onChange={(next) => {
            setChecked(next);
            onChange(next);
          }}
        />
      );
    }

    await render(<Harness />);
    expect(switchButton().getAttribute("aria-checked")).toBe("false");
    await act(async () => {
      switchButton().click();
    });
    expect(onChange).toHaveBeenCalledWith(true);
    expect(switchButton().getAttribute("aria-checked")).toBe("true");
  });

  it("开关在已开时点出 false", async () => {
    const onChange = vi.fn();
    await render(
      <SettingsSwitch checked onChange={onChange} label="telemetry" />,
    );
    expect(switchButton().getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      switchButton().click();
    });
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("开关禁用时不发事件", async () => {
    const onChange = vi.fn();
    await render(
      <SettingsSwitch
        checked={false}
        onChange={onChange}
        label="telemetry"
        disabled
      />,
    );
    await act(async () => {
      switchButton().click();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("下拉带上无障碍名，并把新值发出去", async () => {
    const onChange = vi.fn();

    function Harness() {
      const [value, setValue] = useState<"zh" | "en">("zh");
      return (
        <SettingsSelect
          testId="language"
          label="语言"
          value={value}
          options={[
            { value: "zh", label: "简体中文" },
            { value: "en", label: "English" },
          ]}
          onChange={(next) => {
            setValue(next);
            onChange(next);
          }}
        />
      );
    }

    await render(<Harness />);
    // **不是原生 select**：原生展开菜单由系统绘制，主题跟不了 app（用量页踩过一次）
    expect(container.querySelector("select")).toBeNull();
    const trigger = menuTrigger(container, "language");
    expect(trigger.getAttribute("aria-label")).toBe("语言");
    expect(trigger.textContent).toContain("简体中文");

    await pickOption(container, "language", "en");
    expect(onChange).toHaveBeenCalledWith("en");
    // 受控值真的回流了：只看 onChange 被调用，抓不到「组件是失控的」这种毛病。
    expect(menuTrigger(container, "language").textContent).toContain("English");
  });

  it("键盘：方向键开菜单与移动、Enter 选中、Esc 关闭并把焦点还回触发按钮", async () => {
    const onChange = vi.fn();
    function KeyboardHarness() {
      const [value, setValue] = useState<"zh" | "en">("zh");
      return (
        <SettingsSelect
          testId="language"
          label="语言"
          value={value}
          options={[
            { value: "zh", label: "简体中文" },
            { value: "en", label: "English" },
          ]}
          onChange={(next) => {
            setValue(next);
            onChange(next);
          }}
        />
      );
    }
    const key = (el: Element, k: string) =>
      act(async () => {
        el.dispatchEvent(
          new KeyboardEvent("keydown", { key: k, bubbles: true }),
        );
      });
    const items = () =>
      Array.from(
        document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
      );
    const trigger = () => menuTrigger(container, "language");

    await render(<KeyboardHarness />);

    // ↓ 打开，焦点落在当前值那一项（zh）
    await key(trigger(), "ArrowDown");
    expect(items()).toHaveLength(2);
    expect(document.activeElement).toBe(items()[0]);

    // ↓ 移到第二项；到底再按回绕到第一项
    await key(items()[0], "ArrowDown");
    expect(document.activeElement).toBe(items()[1]);
    await key(items()[1], "ArrowDown");
    expect(document.activeElement).toBe(items()[0]);

    // ↓ 再到底，停在 "en" 上；Enter：焦点在原生 <button> 上，浏览器会把它翻成 click
    // （jsdom 不翻，所以这里直接点）。选当前项不该回传，所以必须点另一项。
    await key(items()[0], "ArrowDown");
    expect(document.activeElement).toBe(items()[1]);
    await act(async () => {
      items()[1].click();
    });
    expect(onChange).toHaveBeenCalledWith("en");

    // 重开：焦点应落在**新值**那一项（en），而不是永远回到第一项
    await key(trigger(), "ArrowDown");
    expect(document.activeElement).toBe(items()[1]);

    // Esc 关闭，且焦点回到触发按钮（不回的话键盘用户会掉到 body 上）
    await key(items()[1], "Escape");
    expect(
      document.body.querySelector('[data-testid="language-menu"]'),
    ).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("贴着底部打开时按**实际需要的高度**翻转，短菜单不白跳一大截", async () => {
    // 触发按钮贴底：下方只剩 62px，而两项的菜单只要 ~70px。
    // 若拿面板上限（264px）去判断，会把它白翻到 264px 之上 —— 一打开就"跳一下"。
    const rect = {
      top: 600,
      bottom: 630,
      left: 100,
      right: 200,
      width: 100,
      height: 30,
      x: 100,
      y: 600,
      toJSON: () => ({}),
    } as DOMRect;
    const spy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue(rect);
    Object.defineProperty(window, "innerHeight", {
      value: 700,
      configurable: true,
    });
    // 自带一个两选项的 harness：上面那个 Harness 是局部的，这里拿不到
    function TwoOptionSelect() {
      const [value, setValue] = useState<"zh" | "en">("zh");
      return (
        <SettingsSelect
          testId="language"
          label="语言"
          value={value}
          options={[
            { value: "zh", label: "简体中文" },
            { value: "en", label: "English" },
          ]}
          onChange={setValue}
        />
      );
    }

    try {
      await render(<TwoOptionSelect />);
      await openMenu(container, "language");
      const panel = document.body.querySelector<HTMLElement>(
        '[data-testid="language-menu"]',
      )!;
      // 600 - 6 - 70 = 524（按上限算会是 330，差出小半屏）
      expect(panel.style.top).toBe("524px");
    } finally {
      spy.mockRestore();
    }
  });

  it("行渲染标题与说明，没有说明就不占那一层", async () => {
    await render(
      <SettingsCard>
        <SettingsRow title="主题" description="外观偏好" />
        <SettingsRow title="语言" />
      </SettingsCard>,
    );
    expect(container.textContent).toContain("主题");
    expect(container.textContent).toContain("外观偏好");
    expect(container.textContent).toContain("语言");
    expect(container.querySelectorAll(".line-clamp-2")).toHaveLength(1);
  });

  it("子行只缩进文字列并把标题降级，行容器的类串一字不动", async () => {
    await render(
      <SettingsCard>
        <SettingsRow testId="parent" title="语音输入" />
        <SettingsRow
          testId="child"
          sub
          title="语音模型"
          note="关掉开关后要重启"
        />
      </SettingsCard>,
    );
    const parent = container.querySelector<HTMLElement>(
      '[data-testid="parent"]',
    )!;
    const child = container.querySelector<HTMLElement>(
      '[data-testid="child"]',
    )!;

    // 行容器（分隔线 + 内边距）必须完全一致：panel-boundary.test.ts 守着这个字面串。
    expect(parent.className).toContain(
      "border-t border-border-muted px-4 py-3",
    );
    expect(child.className).toBe(parent.className);

    const textCol = (row: HTMLElement) => row.firstElementChild as HTMLElement;
    const titleOf = (row: HTMLElement) =>
      (row.firstElementChild as HTMLElement).firstElementChild as HTMLElement;

    expect(textCol(parent).className).toBe("min-w-0 flex-1");
    expect(textCol(child).className).toBe("min-w-0 flex-1 pl-4");
    expect(titleOf(parent).className).toContain(
      "text-sm font-medium text-text-primary",
    );
    expect(titleOf(child).className).toContain("text-xs text-text-secondary");
  });

  it("badge 落在标题行内，标题文字仍是标题节点的第一个文本节点", async () => {
    await render(
      <SettingsCard>
        <SettingsRow
          testId="child"
          sub
          title="语音模型"
          badge={<SettingsStatusBadge tone="ok" label="已安装" />}
        />
      </SettingsCard>,
    );
    const row = container.querySelector<HTMLElement>('[data-testid="child"]')!;
    const titleNode = (row.firstElementChild as HTMLElement)
      .firstElementChild as HTMLElement;

    expect(titleNode.firstChild?.textContent).toBe("语音模型");
    expect(titleNode.textContent).toContain("已安装");
  });

  it("四个档位的徽标各自用对应的语义色", async () => {
    await render(
      <div>
        <SettingsStatusBadge tone="ok" label="已安装" />
        <SettingsStatusBadge tone="muted" label="未安装" />
        <SettingsStatusBadge tone="busy" label="下载中 42%" />
        <SettingsStatusBadge tone="error" label="下载失败" />
      </div>,
    );
    const html = container.innerHTML;
    for (const className of [
      "bg-success",
      "bg-text-muted",
      "bg-accent",
      "bg-error",
    ]) {
      expect(html).toContain(className);
    }
    expect(container.textContent).toBe("已安装未安装下载中 42%下载失败");
  });
});
