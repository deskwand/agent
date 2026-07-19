// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageLightbox } from "../src/renderer/components/ImageLightbox";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("ImageLightbox pointer dragging", () => {
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

  it("captures the pointer while dragging a zoomed image and releases it on pointer up", () => {
    act(() => {
      root.render(
        createElement(ImageLightbox, {
          isOpen: true,
          images: [{ src: "data:image/png;base64,AA==", name: "image" }],
          onClose: () => undefined,
        }),
      );
    });

    const image = container.querySelector("img");
    const dragSurface = image?.parentElement;
    const imageArea = dragSurface?.parentElement;
    expect(image).not.toBeNull();
    expect(dragSurface).not.toBeNull();
    expect(imageArea).not.toBeNull();

    act(() => {
      imageArea?.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY: -1,
          clientX: 100,
          clientY: 100,
        }),
      );
    });
    expect(image?.style.transform).toContain("scale(1.25)");
    const initialOffset = readTranslate(image?.style.transform ?? "");

    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.assign(dragSurface!, {
      setPointerCapture,
      hasPointerCapture: () => true,
      releasePointerCapture,
    });

    act(() => {
      dragSurface?.dispatchEvent(pointerEvent("pointerdown", 7, 100, 100));
    });
    expect(setPointerCapture).toHaveBeenCalledWith(7);

    const transformBeforeSecondPointer = image?.style.transform;
    act(() => {
      dragSurface?.dispatchEvent(pointerEvent("pointerdown", 8, 200, 200));
      dragSurface?.dispatchEvent(pointerEvent("pointermove", 8, 250, 250));
      dragSurface?.dispatchEvent(pointerEvent("pointerup", 8, 250, 250));
    });
    expect(setPointerCapture).not.toHaveBeenCalledWith(8);
    expect(releasePointerCapture).not.toHaveBeenCalledWith(8);
    expect(image?.style.transform).toBe(transformBeforeSecondPointer);
    expect(image?.style.transition).toBe("none");

    act(() => {
      dragSurface?.dispatchEvent(pointerEvent("pointermove", 7, 120, 130));
    });
    expect(readTranslate(image?.style.transform ?? "")).toEqual({
      x: initialOffset.x + 20,
      y: initialOffset.y + 30,
    });

    act(() => {
      dragSurface?.dispatchEvent(pointerEvent("pointerup", 7, 120, 130));
    });
    expect(releasePointerCapture).toHaveBeenCalledWith(7);

    act(() => {
      dragSurface?.dispatchEvent(pointerEvent("pointerdown", 8, 120, 130));
      dragSurface?.dispatchEvent(pointerEvent("pointercancel", 8, 120, 130));
    });
    expect(releasePointerCapture).toHaveBeenCalledWith(8);
    expect(image?.style.transition).not.toBe("none");
  });
});

function readTranslate(transform: string): { x: number; y: number } {
  const match = transform.match(/translate\((-?\d+)px, (-?\d+)px\)/);
  if (!match) throw new Error(`Missing translate in: ${transform}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

function pointerEvent(
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  pointerId: number,
  clientX: number,
  clientY: number,
): Event {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
  });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event;
}
