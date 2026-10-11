// @vitest-environment jsdom
//
// SettingsGeneral「主题」分段控件的**行为**网（不是类名断言）：结构语义、点击回传、
// 方向键漫游，以及「再点当前项时 Radix 回传空串」不能把必选的主题清掉。
//
// 为什么要单独一层网：这三个档位原来是一组手绘 Button（role=group + aria-pressed），
// 没有 radiogroup 语义、方向键也不生效 —— 迁移到 ToggleGroup 后这些行为由原语提供，
// 页面级测试不盯它们就会静默回退。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
}));

import { SettingsGeneral } from "../../renderer/components/settings/SettingsGeneral";
import type * as AppStoreModule from "../../renderer/store";
import { useAppStore } from "../../renderer/store";

let container: HTMLDivElement;
let root: Root;

/** 只记录「组件写回了什么」；真实 action 会走 IPC，与本测试无关。 */
const updateSpy = vi.fn();

function seedStore(): void {
  const initial = useAppStore.getInitialState();
  useAppStore.setState({
    ...initial,
    settings: { ...initial.settings, theme: "light" },
    updateSettings: (patch) => {
      updateSpy(patch);
      useAppStore.setState((state) => ({
        settings: { ...state.settings, ...patch },
      }));
    },
  });
}

const group = () =>
  container.querySelector<HTMLElement>('[role="radiogroup"]')!;
const radios = () =>
  Array.from(container.querySelectorAll<HTMLElement>('[role="radio"]'));
const segment = (label: string) =>
  radios().find((node) => node.textContent === label)!;

async function render(): Promise<void> {
  await act(async () => {
    root.render(<SettingsGeneral />);
  });
}

async function click(node: HTMLElement): Promise<void> {
  await act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function press(node: HTMLElement, key: string): Promise<void> {
  await act(async () => {
    node.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
  // Radix 的漫游用 setTimeout 落焦：等一个宏任务再断言 activeElement。
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  updateSpy.mockClear();
  seedStore();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("设置页主题分段选择", () => {
  it("是一个有名且唯一的 radiogroup，档位顺序与选中态跟当前值一致", async () => {
    await render();
    expect(container.querySelectorAll('[role="radiogroup"]')).toHaveLength(1);
    expect(group().getAttribute("aria-label")).toBe("general.theme");
    expect(radios().map((node) => node.textContent)).toEqual([
      "general.themeLight",
      "general.themeDark",
      "general.themeSystem",
    ]);
    expect(radios().map((node) => node.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false",
    ]);
  });

  it("点未选中档位写回一次，选中态跟着走", async () => {
    await render();
    await click(segment("general.themeDark"));
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith({ theme: "dark" });
    expect(segment("general.themeDark").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(segment("general.themeLight").getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("方向键在档位间漫游焦点，不擅自改写设置", async () => {
    await render();
    const light = segment("general.themeLight");
    await act(async () => {
      light.focus();
    });
    await press(light, "ArrowRight");
    expect(document.activeElement).toBe(segment("general.themeDark"));
    // Radix 单选的方向键只漫游焦点（正合 radiogroup 的 APG 建议）：改值要等用户
    // 按空格/回车激活 —— 扫过就写回会把主题抖动成中间档位。
    expect(updateSpy).not.toHaveBeenCalled();
    expect(segment("general.themeLight").getAttribute("aria-checked")).toBe(
      "true",
    );

    await press(segment("general.themeDark"), "ArrowLeft");
    expect(document.activeElement).toBe(segment("general.themeLight"));
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("再点当前档位回传的空串不写回（主题是必选项）", async () => {
    await render();
    await click(segment("general.themeLight"));
    expect(updateSpy).not.toHaveBeenCalled();
    expect(segment("general.themeLight").getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("原语回传的未知值同样不写回（显式联合分支）", async () => {
    // 真实原语只会回传档位自己的 value 或 ""，未知值要制造出来只能换成桩原语。
    // 这里换掉两个模块（原语 + store），单独验证 handler 的收窄分支。
    vi.resetModules();
    const isolatedUpdate = vi.fn();
    vi.doMock("../../renderer/components/ui/toggle-group", () => ({
      ToggleGroup: ({
        onValueChange,
      }: {
        onValueChange: (value: string) => void;
      }) => (
        <div role="radiogroup" aria-label="general.theme">
          <button
            type="button"
            data-testid="emit-valid"
            onClick={() => onValueChange("dark")}
          />
          <button
            type="button"
            data-testid="emit-empty"
            onClick={() => onValueChange("")}
          />
          <button
            type="button"
            data-testid="emit-unknown"
            onClick={() => onValueChange("midnight")}
          />
        </div>
      ),
      ToggleGroupItem: () => null,
    }));
    vi.doMock("../../renderer/store", async () => {
      const actual = await vi.importActual<typeof AppStoreModule>(
        "../../renderer/store",
      );
      const initial = actual.useAppStore.getInitialState();
      const state = {
        ...initial,
        settings: { ...initial.settings, theme: "light" as const },
        updateSettings: (patch: Partial<typeof initial.settings>) => {
          isolatedUpdate(patch);
        },
      };
      const useAppStore = (selector: (s: typeof state) => unknown) =>
        selector(state);
      return { ...actual, useAppStore };
    });
    const { SettingsGeneral: Isolated } =
      await import("../../renderer/components/settings/SettingsGeneral");
    await act(async () => {
      root.render(<Isolated />);
    });

    const tap = async (testId: string): Promise<void> => {
      await click(
        container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!,
      );
    };
    await tap("emit-valid");
    expect(isolatedUpdate).toHaveBeenCalledTimes(1);
    expect(isolatedUpdate).toHaveBeenCalledWith({ theme: "dark" });

    await tap("emit-empty");
    await tap("emit-unknown");
    expect(isolatedUpdate).toHaveBeenCalledTimes(1);
  });
});
