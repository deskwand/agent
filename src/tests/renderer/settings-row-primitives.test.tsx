// @vitest-environment jsdom
import { act, useState, type ReactNode } from "react";
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
    const select = container.querySelector<HTMLSelectElement>("select")!;
    expect(select.getAttribute("aria-label")).toBe("语言");
    expect(select.value).toBe("zh");
    await act(async () => {
      select.value = "en";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("en");
    // 受控值真的回流了：只看 onChange 被调用，抓不到「组件是失控的」这种毛病。
    expect(container.querySelector<HTMLSelectElement>("select")!.value).toBe(
      "en",
    );
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
