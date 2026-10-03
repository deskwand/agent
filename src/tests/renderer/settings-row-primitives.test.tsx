// @vitest-environment jsdom
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SettingsCard,
  SettingsRow,
  SettingsSelect,
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
});
