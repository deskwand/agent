// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResizeHandle } from "../../renderer/components/ResizeHandle";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function drag(
  start: { x: number; y: number },
  end: { x: number; y: number },
): void {
  const handle = container.firstElementChild as HTMLElement;
  act(() => {
    handle.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        clientX: start.x,
        clientY: start.y,
      }),
    );
  });
  act(() => {
    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: end.x, clientY: end.y }),
    );
  });
  act(() => {
    document.dispatchEvent(new MouseEvent("mouseup"));
  });
}

describe("ResizeHandle axis", () => {
  it("axis=y 按 clientY 计算", () => {
    const onResize = vi.fn();
    act(() => root.render(<ResizeHandle axis="y" onResize={onResize} />));
    drag({ x: 0, y: 100 }, { x: 50, y: 130 });
    expect(onResize).toHaveBeenCalledWith(30);
  });

  it("默认轴向仍按 clientX 计算", () => {
    const onResize = vi.fn();
    act(() => root.render(<ResizeHandle onResize={onResize} />));
    drag({ x: 10, y: 100 }, { x: 25, y: 300 });
    expect(onResize).toHaveBeenCalledWith(15);
  });
});
