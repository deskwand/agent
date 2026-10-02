import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ComponentType } from "react";
import type { PetState } from "../main/desktop-pet/pet-state";
import {
  DEFAULT_PET_CHARACTER,
  isPetCharacter,
  type PetCharacter,
} from "../shared/pet-characters";
import { PetGhost } from "./pet-ghost";
import { PetLens } from "./pet-lens";
import { PetSlime } from "./pet-slime";
import "./styles/pet.css";

export interface PetCharacterProps {
  state: PetState;
}

/**
 * 穷尽的角色映射：漏一只就编译不过（与 WelcomeView 的 QUICK_ENTRY_ICONS 同一手法）。
 * 镜片只声明 `{ state }`——更窄的 props 可直接放进这里，不必为"统一签名"改它。
 */
const PET_CHARACTER_COMPONENTS: Record<
  PetCharacter,
  ComponentType<PetCharacterProps>
> = {
  lens: PetLens,
  slime: PetSlime,
  ghost: PetGhost,
};

declare global {
  interface Window {
    petAPI: {
      onState: (listener: (state: PetState) => void) => () => void;
      onCharacter: (listener: (character: string) => void) => () => void;
      openCharacterMenu: () => void;
      activate: () => void;
      drag: (delta: { dx: number; dy: number; done: boolean }) => void;
    };
  }
}

function Pet() {
  const [state, setState] = useState<PetState>("idle");
  const [character, setCharacter] = useState<PetCharacter>(
    DEFAULT_PET_CHARACTER,
  );
  const pointer = useRef<{
    x: number;
    y: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  // preload 若没加载成功（webPreferences 被改错、脚本报错），这里不能整页崩掉：
  // 窗口自己会保持隐藏，但主进程日志里已有 did-fail-load 线索。
  useEffect(() => window.petAPI?.onState(setState), []);
  useEffect(
    () =>
      window.petAPI?.onCharacter((next) => {
        // 主进程理论上只发合法 id，但渲染层不能假设：非法值保持当前角色。
        if (isPetCharacter(next)) setCharacter(next);
      }),
    [],
  );

  const Character = PET_CHARACTER_COMPONENTS[character];

  return (
    <div
      className="pet-target"
      onContextMenu={(event) => {
        event.preventDefault();
        window.petAPI?.openCharacterMenu();
      }}
      onPointerDown={(event) => {
        // 只认左键：右键要交给 contextmenu，否则右键松开会走完这条路径并唤回主窗口。
        if (event.button !== 0) return;
        pointer.current = {
          x: event.screenX,
          y: event.screenY,
          originX: event.screenX,
          originY: event.screenY,
          moved: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const previous = pointer.current;
        if (!previous) return;
        if (
          Math.hypot(
            event.screenX - previous.originX,
            event.screenY - previous.originY,
          ) > 5
        )
          previous.moved = true;
        if (previous.moved) {
          window.petAPI?.drag({
            dx: event.screenX - previous.x,
            dy: event.screenY - previous.y,
            done: false,
          });
        }
        previous.x = event.screenX;
        previous.y = event.screenY;
      }}
      onPointerUp={(event) => {
        // 与 down 一致只认左键：左键按住期间再松开右键，不该被当成"点击"而唤回主窗口。
        if (event.button !== 0) return;
        const previous = pointer.current;
        pointer.current = null;
        if (!previous) return;
        if (previous.moved) window.petAPI?.drag({ dx: 0, dy: 0, done: true });
        else window.petAPI?.activate();
      }}
      onPointerCancel={() => {
        if (pointer.current?.moved)
          window.petAPI?.drag({ dx: 0, dy: 0, done: true });
        pointer.current = null;
      }}
    >
      <Character state={state} />
    </div>
  );
}

createRoot(document.getElementById("pet-root")!).render(<Pet />);
