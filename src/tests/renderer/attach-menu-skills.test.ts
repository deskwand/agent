// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttachMenu } from "../../renderer/components/attach/AttachMenu";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const skillsGetAll = vi.fn();

type MenuProps = React.ComponentProps<typeof AttachMenu>;

const skills = [
  {
    id: "1",
    name: "pdf",
    description: "",
    type: "builtin" as const,
    enabled: true,
    createdAt: 0,
  },
  {
    id: "2",
    name: "officecli",
    description: "",
    type: "builtin" as const,
    enabled: true,
    createdAt: 1,
  },
  {
    id: "3",
    name: "review",
    description: "",
    type: "builtin" as const,
    enabled: true,
    createdAt: 2,
  },
  {
    id: "4",
    name: "gone",
    description: "",
    type: "builtin" as const,
    enabled: false,
    createdAt: 3,
  },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  skillsGetAll.mockReset();
  skillsGetAll.mockResolvedValue(skills);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    skills: { getAll: skillsGetAll },
    vault: { getSnapshot: vi.fn().mockRejectedValue(new Error("no vault")) },
    scanWorkspaceFiles: vi.fn(),
    piCommands: { list: vi.fn().mockResolvedValue({ commands: [] }) },
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

async function openMenu(props: Partial<MenuProps> = {}, pinned: string[] = []) {
  localStorage.setItem("deskwand.pinnedSkills", JSON.stringify(pinned));
  const merged = {
    cwd: "/repo",
    onPickLocalFiles: vi.fn(),
    onAddFiles: vi.fn(),
    attachedKeys: new Set<string>(),
    ...props,
  };
  act(() => {
    root.render(React.createElement(AttachMenu, merged));
  });
  await act(async () => {
    trigger().click();
  });
  await act(async () => {
    await Promise.resolve();
  });
  return merged;
}

function trigger(): HTMLButtonElement {
  const button = container.querySelector("button[data-attach-trigger]");
  if (!button) throw new Error("attach trigger not rendered");
  return button as HTMLButtonElement;
}

function skillRows(): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>("[data-skill-row]")];
}

function pinButton(name: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    `[data-skill-pin='${name}']`,
  );
  if (!button) throw new Error(`pin button not rendered: ${name}`);
  return button;
}

function keyDown(element: Element, key: string) {
  act(() => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

function labeled(text: string): HTMLButtonElement {
  const found = [
    ...container.querySelectorAll<HTMLButtonElement>(
      "[role='menuitem'], [data-command-create]",
    ),
  ].find((button) => button.textContent?.includes(text));
  if (!found) throw new Error(`menu item not found: ${text}`);
  return found;
}

describe("+ 菜单的技能组", () => {
  it("不传 onInsertSkill 时整组不渲染，也不发 IPC", async () => {
    await openMenu();
    expect(skillRows()).toHaveLength(0);
    expect(skillsGetAll).not.toHaveBeenCalled();
  });

  it("星标技能在前、最近调用补齐在后，禁用技能不占名额", async () => {
    localStorage.setItem("slashRecency", JSON.stringify({ "skill:review": 1 }));
    await openMenu({ onInsertSkill: vi.fn() }, ["pdf", "gone"]);

    expect(skillRows().map((row) => row.dataset.skillRow)).toEqual([
      "pdf",
      "review",
    ]);
  });

  it("点行把技能名交给宿主并关闭菜单", async () => {
    const onInsertSkill = vi.fn();
    const onDismiss = vi.fn();
    await openMenu({ onInsertSkill, onDismiss }, ["pdf"]);

    await act(async () => {
      skillRows()[0].click();
    });

    expect(onInsertSkill).toHaveBeenCalledWith("pdf");
    expect(container.querySelector("[role='menu']")).toBeNull();
    expect(onDismiss).toHaveBeenCalled();
  });

  it("点行首星标只切换固定：不插入技能，也不重拉技能表", async () => {
    const onInsertSkill = vi.fn();
    await openMenu({ onInsertSkill }, ["pdf"]);

    await act(async () => {
      pinButton("pdf").click();
    });

    expect(onInsertSkill).not.toHaveBeenCalled();
    // 纯本地重算：只有打开菜单那一次 IPC
    expect(skillsGetAll).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(localStorage.getItem("deskwand.pinnedSkills") ?? "[]"),
    ).toEqual([]);
    // 取消固定后 pdf 既不在星标里也不在最近调用里，整组随之消失
    expect(skillRows()).toHaveLength(0);
  });

  it("点行首星标能把最近调用里的技能固定住（补齐区也能上星）", async () => {
    localStorage.setItem("slashRecency", JSON.stringify({ "skill:review": 1 }));
    await openMenu({ onInsertSkill: vi.fn() }, []);

    expect(skillRows().map((row) => row.dataset.skillRow)).toEqual(["review"]);

    await act(async () => {
      pinButton("review").click();
    });

    expect(
      JSON.parse(localStorage.getItem("deskwand.pinnedSkills") ?? "[]"),
    ).toEqual(["review"]);
    expect(
      container
        .querySelector("[data-skill-pin='review'] svg")
        ?.getAttribute("fill"),
    ).toBe("currentColor");
  });

  it("星标超过 5 个时只显示前 5 行，标题右侧出现 5/N 计数", async () => {
    const many = ["s1", "s2", "s3", "s4", "s5", "s6"];
    const extra = many.map((name, index) => ({
      id: `x${index}`,
      name,
      description: "",
      type: "builtin" as const,
      enabled: true,
      createdAt: index,
    }));
    skillsGetAll.mockResolvedValue([...skills, ...extra]);

    await openMenu({ onInsertSkill: vi.fn() }, many);

    expect(skillRows()).toHaveLength(5);
    expect(container.querySelector("[role='menu']")?.textContent).toContain(
      "chat.skillOverflow",
    );
  });

  it("技能组在场时，焦点环仍按渲染顺序走：附件 → 技能 → 命令组", async () => {
    // 这条用例是 commandGroupBase 的唯一守卫：既有 attach-menu 用例都不传
    // onInsertSkill，skillRows.length === 0，下标与改造前的字面量一模一样。
    await openMenu({ onInsertSkill: vi.fn(), onCommandEntry: vi.fn() }, [
      "pdf",
    ]);

    const walk = [
      labeled("attachMenu.localFile"),
      labeled("attachMenu.workspace"),
      labeled("attachMenu.vault"),
      container.querySelector<HTMLButtonElement>("[data-skill-row='pdf']")!,
      container.querySelector<HTMLButtonElement>("[data-command-create]")!,
      labeled("slash.compact"),
      labeled("slash.goal"),
    ];
    expect(document.activeElement).toBe(walk[0]);

    for (let i = 1; i < walk.length; i++) {
      keyDown(document.activeElement!, "ArrowDown");
      expect(document.activeElement, `第 ${i} 站`).toBe(walk[i]);
    }

    // 尾巴接回开头：环是闭合的，没有卡死的节点
    keyDown(document.activeElement!, "ArrowDown");
    expect(document.activeElement).toBe(walk[0]);
  });

  it("取消固定把行拿掉之后，焦点回到菜单内（否则菜单键全失效）", async () => {
    await openMenu({ onInsertSkill: vi.fn() }, ["pdf"]);
    const pin = pinButton("pdf");
    pin.focus();
    expect(document.activeElement).toBe(pin);

    await act(async () => {
      pin.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    // 行与整组都消失了，但焦点必须仍落在菜单里
    expect(skillRows()).toHaveLength(0);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.textContent ?? "").toContain(
      "attachMenu.localFile",
    );
  });

  it("星标正好 5 个时不显示计数（5/N 的边界）", async () => {
    const many = ["s1", "s2", "s3", "s4", "s5"];
    const extra = many.map((name, index) => ({
      id: `y${index}`,
      name,
      description: "",
      type: "builtin" as const,
      enabled: true,
      createdAt: index,
    }));
    skillsGetAll.mockResolvedValue([...skills, ...extra]);

    await openMenu({ onInsertSkill: vi.fn() }, many);

    expect(skillRows()).toHaveLength(5);
    expect(container.querySelector("[role='menu']")?.textContent).not.toContain(
      "chat.skillOverflow",
    );
  });

  it("技能表拉取失败时只留一行提示，不留空组", async () => {
    skillsGetAll.mockRejectedValue(new Error("boom"));
    await openMenu({ onInsertSkill: vi.fn() }, ["pdf"]);

    expect(skillRows()).toHaveLength(0);
    expect(container.querySelector("[role='menu']")?.textContent).toContain(
      "chat.commandSkillLoadFailed",
    );
  });
});
