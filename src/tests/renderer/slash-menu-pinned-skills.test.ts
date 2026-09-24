// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlashMenu } from "../../renderer/components/SlashMenu";
import type { Skill } from "../../renderer/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const skills: Skill[] = [
  {
    id: "1",
    name: "pdf",
    description: "处理 PDF",
    type: "builtin",
    enabled: true,
    createdAt: 0,
  },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderMenu(props: {
  pinnedSkills: string[];
  onToggleSkillPin: (name: string) => void;
  onSelect?: (item: unknown) => void;
}) {
  act(() => {
    root.render(
      React.createElement(SlashMenu, {
        commands: [],
        skills,
        activeTab: "skills",
        selectedIndex: -1,
        onSelect: props.onSelect ?? (() => undefined),
        onTabChange: () => undefined,
        pinnedSkills: props.pinnedSkills,
        onToggleSkillPin: props.onToggleSkillPin,
      }),
    );
  });
}

function pinButton(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    "[data-skill-pin='pdf']",
  );
  if (!button) throw new Error("pin button not rendered");
  return button;
}

describe("斜杠菜单技能行的星标", () => {
  it("点星只切换固定，不触发行选中", () => {
    const onSelect = vi.fn();
    const onToggleSkillPin = vi.fn();
    renderMenu({ pinnedSkills: [], onToggleSkillPin, onSelect });

    act(() => {
      pinButton().dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
    });

    expect(onToggleSkillPin).toHaveBeenCalledWith("pdf");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("未固定是空心 + muted，已固定是实心 + accent", () => {
    renderMenu({ pinnedSkills: [], onToggleSkillPin: () => undefined });
    expect(pinButton().querySelector("svg")?.getAttribute("fill")).toBe("none");
    expect(pinButton().className).toContain("text-text-muted");

    renderMenu({ pinnedSkills: ["pdf"], onToggleSkillPin: () => undefined });
    expect(pinButton().querySelector("svg")?.getAttribute("fill")).toBe(
      "currentColor",
    );
    expect(pinButton().className).toContain("text-accent");
  });

  it("星标按钮的无障碍名随状态切换", () => {
    renderMenu({ pinnedSkills: [], onToggleSkillPin: () => undefined });
    expect(pinButton().getAttribute("aria-label")).toBe("chat.skillPinAdd");

    renderMenu({ pinnedSkills: ["pdf"], onToggleSkillPin: () => undefined });
    expect(pinButton().getAttribute("aria-label")).toBe("chat.skillPinRemove");
  });

  it("星标按钮不进 Tab 序（键盘路径仍只走行按钮）", () => {
    renderMenu({ pinnedSkills: [], onToggleSkillPin: () => undefined });
    expect(pinButton().getAttribute("tabindex")).toBe("-1");
  });
});
