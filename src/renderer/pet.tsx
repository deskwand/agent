import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PetState } from "../main/desktop-pet/pet-state";
import { PetLens } from "./pet-lens";
import "./styles/pet.css";

declare global {
  interface Window {
    petAPI: {
      onState: (listener: (state: PetState) => void) => () => void;
      activate: () => void;
      drag: (delta: { dx: number; dy: number; done: boolean }) => void;
    };
  }
}

function Pet() {
  const [state, setState] = useState<PetState>("idle");
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

  return (
    <div
      className="pet-target"
      onPointerDown={(event) => {
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
      onPointerUp={() => {
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
      <PetLens state={state} />
    </div>
  );
}

createRoot(document.getElementById("pet-root")!).render(<Pet />);
