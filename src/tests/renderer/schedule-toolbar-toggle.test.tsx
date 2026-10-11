// @vitest-environment jsdom
//
// 日程工具栏「日/周/月」分段控件的**行为**网：radiogroup 语义、点击回传、方向键漫游，
// 以及「再点当前视图时 Radix 回传空串」不能把必选视图清掉（视图清空会连带清掉
// ScheduleView 的滚动/刷新语义）。
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
}));

import { ScheduleToolbar } from "../../renderer/components/ScheduleToolbar";
import type { CalendarView } from "../../renderer/components/ScheduleCalendar";

let container: HTMLDivElement;
let root: Root;
const onViewChange = vi.fn();

/** 受控外壳：真实调用点（ScheduleView）就是拿 state 里的 view 传进来的。 */
function Harness() {
  const [view, setView] = useState<CalendarView>("week");
  return (
    <ScheduleToolbar
      view={view}
      currentDate={new Date(2026, 9, 11)}
      onViewChange={(next) => {
        onViewChange(next);
        setView(next);
      }}
      onNavigatePrev={() => {}}
      onNavigateNext={() => {}}
      onToday={() => {}}
      onCreateClick={() => {}}
    />
  );
}

const group = () =>
  container.querySelector<HTMLElement>('[role="radiogroup"]')!;
const radios = () =>
  Array.from(container.querySelectorAll<HTMLElement>('[role="radio"]'));
const segment = (label: string) =>
  radios().find((node) => node.textContent === label)!;

async function render(): Promise<void> {
  await act(async () => {
    root.render(<Harness />);
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
  onViewChange.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("日程工具栏视图分段选择", () => {
  it("是一个有名且唯一的 radiogroup，三个视图按 日/周/月 顺序排布", async () => {
    await render();
    expect(container.querySelectorAll('[role="radiogroup"]')).toHaveLength(1);
    expect(group().getAttribute("aria-label")).toBe("schedule.viewLabel");
    expect(radios().map((node) => node.textContent)).toEqual([
      "schedule.viewDay",
      "schedule.viewWeek",
      "schedule.viewMonth",
    ]);
    expect(radios().map((node) => node.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
    ]);
  });

  it("点未选中视图回传一次，选中态跟着走", async () => {
    await render();
    await click(segment("schedule.viewMonth"));
    expect(onViewChange).toHaveBeenCalledTimes(1);
    expect(onViewChange).toHaveBeenCalledWith("month");
    expect(segment("schedule.viewMonth").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(segment("schedule.viewWeek").getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("方向键在视图间漫游焦点，不擅自改写设置", async () => {
    await render();
    const week = segment("schedule.viewWeek");
    await act(async () => {
      week.focus();
    });
    await press(week, "ArrowRight");
    expect(document.activeElement).toBe(segment("schedule.viewMonth"));
    // Radix 单选的方向键只漫游焦点（正合 radiogroup 的 APG 建议）：改值要等用户
    // 按空格/回车激活；箭头扫过就把视图刷一遍会连带触发 ScheduleView 的滚动/刷新。
    expect(onViewChange).not.toHaveBeenCalled();
    expect(segment("schedule.viewWeek").getAttribute("aria-checked")).toBe(
      "true",
    );

    await press(segment("schedule.viewMonth"), "ArrowLeft");
    expect(document.activeElement).toBe(segment("schedule.viewWeek"));
    expect(onViewChange).not.toHaveBeenCalled();
  });

  it("再点当前视图回传的空串不写回（视图是必选项）", async () => {
    await render();
    await click(segment("schedule.viewWeek"));
    expect(onViewChange).not.toHaveBeenCalled();
    expect(segment("schedule.viewWeek").getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("原语回传的未知值同样不写回（显式联合分支）", async () => {
    // 真实原语只会回传档位自己的 value 或 ""，未知值要制造出来只能换成桩原语。
    vi.resetModules();
    const isolatedViewChange = vi.fn();
    vi.doMock("../../renderer/components/ui/toggle-group", () => ({
      ToggleGroup: ({
        onValueChange,
      }: {
        onValueChange: (value: string) => void;
      }) => (
        <div role="radiogroup" aria-label="schedule.viewLabel">
          <button
            type="button"
            data-testid="emit-valid"
            onClick={() => onValueChange("month")}
          />
          <button
            type="button"
            data-testid="emit-empty"
            onClick={() => onValueChange("")}
          />
          <button
            type="button"
            data-testid="emit-unknown"
            onClick={() => onValueChange("year")}
          />
        </div>
      ),
      ToggleGroupItem: () => null,
    }));
    const { ScheduleToolbar: Isolated } =
      await import("../../renderer/components/ScheduleToolbar");
    await act(async () => {
      root.render(
        <Isolated
          view="week"
          currentDate={new Date(2026, 9, 11)}
          onViewChange={isolatedViewChange}
          onNavigatePrev={() => {}}
          onNavigateNext={() => {}}
          onToday={() => {}}
          onCreateClick={() => {}}
        />,
      );
    });

    const tap = async (testId: string): Promise<void> => {
      await click(
        container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!,
      );
    };
    await tap("emit-valid");
    expect(isolatedViewChange).toHaveBeenCalledTimes(1);
    expect(isolatedViewChange).toHaveBeenCalledWith("month");

    await tap("emit-empty");
    await tap("emit-unknown");
    expect(isolatedViewChange).toHaveBeenCalledTimes(1);
  });
});
