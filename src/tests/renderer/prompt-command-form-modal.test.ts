// @vitest-environment jsdom
//
// 弹窗 portal 到 document.body，所以查元素一律用 document.querySelector：
// portal 出来的节点是测试 container 的兄弟，用 container.querySelector 会全部拿到 null。
// 同 attach-picker-modal.test.ts:50。
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PromptCommandFormModal } from "../../renderer/components/attach/PromptCommandFormModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../renderer/hooks/useBrowserOcclusion", () => ({
  useBrowserOcclusion: () => {},
}));

const getSkills = vi.fn();

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  getSkills.mockReset().mockResolvedValue([
    {
      id: "1",
      name: "brainstorming",
      description: "把想法变成设计",
      type: "builtin",
      enabled: true,
    },
    { id: "2", name: "humanizer", description: "去 AI 味", type: "custom", enabled: true },
    { id: "3", name: "disabled-one", description: "停用的", type: "custom", enabled: false },
  ]);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    skills: { getAll: getSkills },
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function render(
  props: Partial<React.ComponentProps<typeof PromptCommandFormModal>> = {},
) {
  const merged = {
    mode: "create" as const,
    initial: { name: "", displayName: "", content: "" },
    nameError: null,
    saving: false,
    onSave: vi.fn(),
    onClose: vi.fn(),
    ...props,
  };
  act(() => {
    root.render(React.createElement(PromptCommandFormModal, merged));
  });
  return merged;
}

/** 按 data-field 定位：aria-label 现在是 t() 出来的文案，不再是稳定的定位锚。 */
function field(name: string): HTMLInputElement | HTMLTextAreaElement {
  const found = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[data-field="${name}"]`,
  );
  if (!found) throw new Error(`field not found: ${name}`);
  return found;
}

/**
 * 不能用 `el.value = x` 直接赋值：React 的 value tracker 会同步记住这个值，
 * 随后派发的原生 input 事件会被判定为「没变化」，onChange 不触发。
 * 走原型上的原生 setter，tracker 仍停在旧值，React 才会派发 onChange。
 * 同 tests/renderer/attach-picker-panel.test.ts:64。
 */
function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  nativeSetter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("PromptCommandFormModal", () => {
  it("新建态：正文为空时保存禁用", () => {
    render();
    expect(
      document.querySelector<HTMLButtonElement>("[data-form-save]")!.disabled,
    ).toBe(true);
  });

  it("只有三个输入格：命令名 / 正文 / 显示名称（没有描述）", () => {
    render();
    const labels = Array.from(
      document.querySelectorAll<HTMLElement>("[data-field-label]"),
    ).map((el) => el.textContent);
    expect(labels).toEqual([
      "chat.commandName",
      "chat.commandBody",
      "chat.commandDisplayName",
    ]);
    expect(document.body.textContent).not.toContain("chat.commandDescription");
  });

  it("填写后 onSave 收到三个字段", () => {
    const onSave = vi.fn();
    render({ onSave });
    act(() => {
      typeInto(field("name"), "translate");
      typeInto(field("body"), "把内容翻译成英文");
      typeInto(field("displayName"), "翻译成英文");
    });
    act(() => document.querySelector<HTMLButtonElement>("[data-form-save]")!.click());
    expect(onSave).toHaveBeenCalledWith({
      name: "translate",
      displayName: "翻译成英文",
      content: "把内容翻译成英文",
    });
  });

  it("编辑态：命令名只读且带锁定说明", () => {
    render({
      mode: "edit",
      initial: { name: "weekly", displayName: "周报素材", content: "正文" },
    });
    expect(field("name")).toHaveProperty("readOnly", true);
    expect(document.body.textContent).toContain("chat.commandNameHint");
  });

  it("名字非法时显示错误，但不因此禁用保存（改好名字就能重试）", () => {
    render({ nameError: "reserved" });
    expect(document.body.textContent).toContain("chat.commandNameReserved");
    // canSave 不读 nameError：错误来自上一次保存，用户改正后即可直接重试。
    // （旧写法断言的是「禁用保存」，但那是因为字段本来就空 —— 无论名字校验在不在都绿。）
    act(() => {
      typeInto(field("name"), "translate");
      typeInto(field("body"), "正文");
    });
    expect(
      document.querySelector<HTMLButtonElement>("[data-form-save]")!.disabled,
    ).toBe(false);
  });

  it("saving 时禁用保存，Esc 触发 onClose", () => {
    const onClose = vi.fn();
    render({ saving: true, onClose });
    expect(
      document.querySelector<HTMLButtonElement>("[data-form-save]")!.disabled,
    ).toBe(true);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("PromptCommandFormModal · 引用技能", () => {
  it("点按钮列出启用中的技能，不列停用的", async () => {
    render();
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-skill-trigger]")!.click();
    });
    expect(getSkills).toHaveBeenCalledTimes(1);
    const names = Array.from(
      document.querySelectorAll<HTMLElement>("[data-skill-option]"),
    ).map((el) => el.getAttribute("data-skill-option"));
    expect(names).toEqual(["brainstorming", "humanizer"]);
  });

  it("点一个技能 → 正文里出现那句引用，且浮层关掉", async () => {
    render();
    act(() => {
      typeInto(field("body"), "把这次方案过一遍。\n\n$@");
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-skill-trigger]")!.click();
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>("[data-skill-option='brainstorming']")!
        .click();
    });
    const body = field("body") as HTMLTextAreaElement;
    expect(body.value).toContain("chat.commandSkillReference");
    expect(document.querySelector("[data-skill-list]")).toBeNull();
  });

  it("插在光标处（不是永远追加到末尾）", async () => {
    render();
    const body = field("body") as HTMLTextAreaElement;
    act(() => {
      typeInto(body, "AAAAAAAAAA");
    });
    // 把光标停在第 5 个字符处，然后让组件记一次。
    // 用 keyup：React 的 onKeyUp 是常规合成事件；onSelect 在 jsdom 下靠原生 select 事件触发不可靠
    //（真实使用里鼠标拖选也会走 onSelect，实现里三个都接）。
    act(() => {
      body.setSelectionRange(5, 5);
      body.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-skill-trigger]")!.click();
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>("[data-skill-option='brainstorming']")!
        .click();
    });
    const value = (field("body") as HTMLTextAreaElement).value;
    // 组装结果：'AAAAA' + '\n'（保证这句自成一行）+ 引用句 + '\n' + 'AAAAA'
    // 所以引用句从下标 6 开始，不是 5
    expect(value.indexOf("chat.commandSkillReference")).toBe(6);
    expect(value.startsWith("AAAAA\n")).toBe(true);
  });

  it("搜索按技能名过滤", async () => {
    render();
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-skill-trigger]")!.click();
    });
    act(() => {
      typeInto(
        document.querySelector<HTMLInputElement>("[data-skill-search]")!,
        "brain",
      );
    });
    const names = Array.from(
      document.querySelectorAll<HTMLElement>("[data-skill-option]"),
    ).map((el) => el.getAttribute("data-skill-option"));
    expect(names).toEqual(["brainstorming"]);
  });

  it("搜索也匹配描述（与斜杠菜单的技能过滤同口径）", async () => {
    render();
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-skill-trigger]")!.click();
    });
    act(() => {
      // humanizer 的 description 是「去 AI 味」。「味」只在描述里出现，
      // 用它才能确定命中的是描述而不是名字（搜 "AI" 会因 br`ai`nstorming 撞上名字）。
      typeInto(document.querySelector<HTMLInputElement>("[data-skill-search]")!, "味");
    });
    const names = Array.from(
      document.querySelectorAll<HTMLElement>("[data-skill-option]"),
    ).map((el) => el.getAttribute("data-skill-option"));
    expect(names).toEqual(["humanizer"]);
  });

  it("无命中时给「没有匹配的技能」，而不是「没有可用的技能」", async () => {
    render();
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-skill-trigger]")!.click();
    });
    act(() => {
      typeInto(
        document.querySelector<HTMLInputElement>("[data-skill-search]")!,
        "zzz-nothing",
      );
    });
    expect(document.querySelectorAll("[data-skill-option]").length).toBe(0);
    expect(document.body.textContent).toContain("chat.commandSkillNoMatch");
    expect(document.body.textContent).not.toContain("chat.commandSkillEmpty");
  });

  it("无查询且无技能时仍是「没有可用的技能」（改动的另一半分支）", async () => {
    getSkills.mockResolvedValueOnce([]);
    render();
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-skill-trigger]")!.click();
    });
    expect(document.body.textContent).toContain("chat.commandSkillEmpty");
    expect(document.body.textContent).not.toContain("chat.commandSkillNoMatch");
  });

  it("搜索框在滚动容器之外（列表滚动时不会被卷走）", async () => {
    render();
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-skill-trigger]")!.click();
    });
    const scroller = document.querySelector("[data-skill-scroll]")!;
    expect(scroller).not.toBeNull();
    expect(scroller.querySelector("[data-skill-search]")).toBeNull();
    // 反向：选项确实在滚动容器里
    expect(scroller.querySelector("[data-skill-option]")).not.toBeNull();
  });

  it("搜索框自动获焦；Esc 两段：先清空查询，再按一次才关表单", async () => {
    const onClose = vi.fn();
    render({ onClose });
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-skill-trigger]")!.click();
    });
    const search = document.querySelector<HTMLInputElement>("[data-skill-search]")!;
    expect(document.activeElement).toBe(search);

    act(() => {
      typeInto(search, "brain");
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    // 第一段：查询清空，表单还在
    expect(
      document.querySelector<HTMLInputElement>("[data-skill-search]")!.value,
    ).toBe("");
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("技能接口失败时给一行提示，不崩", async () => {
    getSkills.mockRejectedValueOnce(new Error("boom"));
    render();
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-skill-trigger]")!.click();
    });
    expect(document.body.textContent).toContain("chat.commandSkillLoadFailed");
  });
});
