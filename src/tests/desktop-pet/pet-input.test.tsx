// @vitest-environment jsdom
import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";

const petAPI = {
  onState: vi.fn(() => () => {}),
  onCharacter: vi.fn(() => () => {}),
  openCharacterMenu: vi.fn(),
  activate: vi.fn(),
  drag: vi.fn(),
};

beforeEach(() => {
  (window as unknown as { petAPI: typeof petAPI }).petAPI = petAPI;
  document.body.innerHTML = '<div id="pet-root"></div>';
  // jsdom 不实现 pointer capture，而 pet.tsx 在 pointerdown 里会调它。
  Element.prototype.setPointerCapture = () => {};
  vi.resetModules(); // pet.tsx 在模块顶层 createRoot，每个用例都要重新挂一次
});

it("right click opens the character menu and never activates the main window", async () => {
  await act(async () => {
    await import("../../renderer/pet");
  });
  const target = document.querySelector(".pet-target") as HTMLElement;
  const pointer = (type: string, button: number) => {
    const event = new Event(type, { bubbles: true });
    Object.assign(event, { button, screenX: 10, screenY: 10, pointerId: 1 });
    target.dispatchEvent(event);
  };

  await act(async () => {
    target.dispatchEvent(new Event("contextmenu", { bubbles: true }));
  });
  expect(petAPI.openCharacterMenu).toHaveBeenCalledTimes(1);

  // 右键按住到松开：不能走完 pointer 路径去调 activate()
  await act(async () => {
    pointer("pointerdown", 2);
    pointer("pointerup", 2);
  });
  expect(petAPI.activate).not.toHaveBeenCalled();
});

it("left click still brings the main window back", async () => {
  await act(async () => {
    await import("../../renderer/pet");
  });
  const target = document.querySelector(".pet-target") as HTMLElement;
  await act(async () => {
    const down = new Event("pointerdown", { bubbles: true });
    Object.assign(down, { button: 0, screenX: 10, screenY: 10, pointerId: 1 });
    target.dispatchEvent(down);
    // 真实左键松开带 button: 0；不设 button 的事件不是现实中的左键抬起。
    const up = new Event("pointerup", { bubbles: true });
    Object.assign(up, { button: 0, screenX: 10, screenY: 10, pointerId: 1 });
    target.dispatchEvent(up);
  });
  expect(petAPI.activate).toHaveBeenCalledTimes(1);
});
