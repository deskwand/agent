// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SidebarAnimatedSection,
  SidebarGroupIcon,
} from "../../renderer/components/sidebar-disclosure-motion";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface AnimationCall {
  target: Element;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  animation: Animation;
}

const originalAnimateDescriptor = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "animate",
);
const originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollHeight",
);
const originalMatchMediaDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "matchMedia",
);

let calls: AnimationCall[] = [];
let rectHeight = 0;
let contentHeight = 120;
let reducedMotion = false;

function createMockAnimation(): Animation {
  return {
    cancel: vi.fn(),
    oncancel: null,
    onfinish: null,
  } as unknown as Animation;
}

function finish(animation: Animation): void {
  animation.onfinish?.(new Event("finish") as AnimationPlaybackEvent);
}

function heightCall(): AnimationCall {
  const call = calls.find(({ keyframes }) =>
    keyframes.some((keyframe) => keyframe.height !== undefined),
  );
  expect(call).toBeTruthy();
  return call as AnimationCall;
}

function contentCall(): AnimationCall {
  const call = calls.find(({ keyframes }) =>
    keyframes.some((keyframe) => keyframe.opacity !== undefined),
  );
  expect(call).toBeTruthy();
  return call as AnimationCall;
}

describe("Sidebar disclosure motion", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    calls = [];
    rectHeight = 0;
    contentHeight = 120;
    reducedMotion = false;

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: reducedMotion,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      value: function (
        this: Element,
        keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
        options?: number | KeyframeAnimationOptions,
      ): Animation {
        const animation = createMockAnimation();
        calls.push({
          target: this,
          keyframes: Array.isArray(keyframes) ? keyframes : [],
          options:
            typeof options === "number"
              ? { duration: options }
              : (options ?? {}),
          animation,
        });
        return animation;
      },
    });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          x: 0,
          y: 0,
          top: 0,
          right: 0,
          bottom: rectHeight,
          left: 0,
          width: 0,
          height: rectHeight,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => contentHeight,
    });

    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.restoreAllMocks();

    if (originalAnimateDescriptor) {
      Object.defineProperty(
        Element.prototype,
        "animate",
        originalAnimateDescriptor,
      );
    } else {
      Reflect.deleteProperty(Element.prototype, "animate");
    }
    if (originalScrollHeightDescriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollHeight",
        originalScrollHeightDescriptor,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
    }
    if (originalMatchMediaDescriptor) {
      Object.defineProperty(window, "matchMedia", originalMatchMediaDescriptor);
    } else {
      Reflect.deleteProperty(window, "matchMedia");
    }
  });

  async function render(node: React.ReactNode): Promise<void> {
    await act(async () => root.render(node));
  }

  function section(
    expanded: boolean,
    motionVersion: number,
    text = "Conversation",
  ): React.ReactElement {
    return React.createElement(SidebarAnimatedSection, {
      expanded,
      motionVersion,
      children: React.createElement("span", null, text),
    });
  }

  function sessionIcon(
    expanded: boolean,
    motionVersion: number,
  ): React.ReactElement {
    return React.createElement(SidebarGroupIcon, {
      kind: "sessions",
      expanded,
      motionVersion,
    });
  }

  it("animates group content along the same path when opening and closing", async () => {
    await render(section(false, 0));
    expect(container.textContent).not.toContain("Conversation");

    await render(section(true, 1));

    const openingHeight = heightCall();
    expect(openingHeight.keyframes).toEqual([
      { height: "0px" },
      { height: "120px" },
    ]);
    expect(openingHeight.options).toMatchObject({
      duration: 220,
      easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    });
    expect(contentCall().keyframes).toEqual([
      { opacity: 0, transform: "translateY(-4px)" },
      { opacity: 1, transform: "translateY(0)" },
    ]);

    await act(async () => finish(openingHeight.animation));
    calls = [];
    rectHeight = 120;

    await render(section(false, 2));

    const closingHeight = heightCall();
    expect(closingHeight.keyframes).toEqual([
      { height: "120px" },
      { height: "0px" },
    ]);
    expect(contentCall().keyframes).toEqual([
      { opacity: 1, transform: "translateY(0)" },
      { opacity: 0, transform: "translateY(-4px)" },
    ]);

    await act(async () => finish(closingHeight.animation));
    expect(container.textContent).not.toContain("Conversation");
  });

  it("crossfades state icons only when expansion changes", async () => {
    await render(sessionIcon(false, 0));

    const collapsed = container.querySelector(
      ".lucide-message-square",
    ) as SVGElement;
    const expanded = container.querySelector(
      ".lucide-message-square-text",
    ) as SVGElement;
    expect(collapsed.style.opacity).toBe("1");
    expect(expanded.style.opacity).toBe("0");
    expect(collapsed.classList.contains("text-text-muted")).toBe(false);
    expect(expanded.classList.contains("text-text-muted")).toBe(false);
    expect(calls).toHaveLength(0);

    await render(sessionIcon(true, 1));
    expect(calls).toHaveLength(2);
    expect(calls.every(({ options }) => options.duration === 120)).toBe(true);

    calls = [];
    await render(sessionIcon(true, 2));
    expect(calls).toHaveLength(0);
  });

  it("uses opacity-only icon motion when reduced motion is requested", async () => {
    reducedMotion = true;
    await render(sessionIcon(false, 0));
    await render(sessionIcon(true, 1));

    expect(calls).toHaveLength(2);
    expect(
      calls.every(({ keyframes }) =>
        keyframes.every((keyframe) => keyframe.transform === undefined),
      ),
    ).toBe(true);
    expect(
      calls.every(({ keyframes }) =>
        keyframes.some((keyframe) => keyframe.opacity !== undefined),
      ),
    ).toBe(true);
  });

  it("falls back synchronously for icons without Web Animations", async () => {
    Reflect.deleteProperty(Element.prototype, "animate");
    await render(sessionIcon(false, 0));
    await render(sessionIcon(true, 1));

    expect(calls).toHaveLength(0);
    const collapsed = container.querySelector(
      ".lucide-message-square",
    ) as SVGElement;
    const expanded = container.querySelector(
      ".lucide-message-square-text",
    ) as SVGElement;
    expect(collapsed.style.opacity).toBe("0");
    expect(expanded.style.opacity).toBe("1");
  });

  it("animates size changes and reverses from the presentation height", async () => {
    contentHeight = 60;
    await render(section(true, 0, "Five rows"));
    expect(calls).toHaveLength(0);

    contentHeight = 120;
    await render(section(true, 1, "Ten rows"));
    const growing = heightCall();
    expect(growing.keyframes).toEqual([
      { height: "60px" },
      { height: "120px" },
    ]);

    rectHeight = 90;
    contentHeight = 60;
    calls = [];
    await render(section(true, 2, "Five rows"));

    expect(growing.animation.cancel).toHaveBeenCalledOnce();
    expect(heightCall().keyframes).toEqual([
      { height: "90px" },
      { height: "60px" },
    ]);
  });

  it("cancels active motion when content changes without a motion request", async () => {
    contentHeight = 60;
    await render(section(true, 0, "Five rows"));

    contentHeight = 120;
    await render(section(true, 1, "Ten rows"));
    const growing = heightCall();

    calls = [];
    contentHeight = 30;
    await render(section(true, 1, "Filtered rows"));

    expect(growing.animation.cancel).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(0);
  });

  it("snaps automatic expansion changes without animation", async () => {
    await render(section(false, 0));
    await render(section(true, 0));

    expect(calls).toHaveLength(0);
    expect(container.textContent).toContain("Conversation");
  });

  it("uses opacity only when reduced motion is requested", async () => {
    reducedMotion = true;
    await render(section(false, 0));
    await render(section(true, 1));

    expect(calls).toHaveLength(1);
    expect(calls[0].keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(calls[0].options.duration).toBeLessThanOrEqual(120);
  });

  it("snaps size changes under reduced motion", async () => {
    reducedMotion = true;
    contentHeight = 60;
    await render(section(true, 0, "Five rows"));

    calls = [];
    contentHeight = 120;
    await render(section(true, 1, "Ten rows"));

    expect(calls).toHaveLength(0);
    expect(container.textContent).toContain("Ten rows");
  });

  it("falls back synchronously when Web Animations is unavailable", async () => {
    Reflect.deleteProperty(Element.prototype, "animate");
    await render(section(false, 0));
    await render(section(true, 1));

    expect(calls).toHaveLength(0);
    expect(container.textContent).toContain("Conversation");

    await render(section(false, 2));
    expect(container.textContent).not.toContain("Conversation");
  });
});
