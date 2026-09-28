import { EventEmitter } from "node:events";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PetStateTracker } from "../../main/desktop-pet/pet-state";
import type { createPetWindowController as CreateController } from "../../main/desktop-pet/pet-window";

const { windows, ipc, displays, storage, screenEvents, removedScreenEvents } =
  vi.hoisted(() => ({
    windows: [] as Array<MockWindow>,
    ipc: new Map<string, (...args: unknown[]) => void>(),
    displays: [
      { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
      { id: 2, workArea: { x: 1920, y: 0, width: 1920, height: 1080 } },
    ],
    storage: new Map<string, unknown>(),
    screenEvents: new Map<string, () => void>(),
    removedScreenEvents: [] as string[],
  }));

class MockWindow extends EventEmitter {
  webContents = Object.assign(new EventEmitter(), {
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  });
  loadURL = vi.fn();
  loadFile = vi.fn();
  show = vi.fn();
  showInactive = vi.fn();
  isMinimized = vi.fn(() => false);
  focus = vi.fn();
  restore = vi.fn();
  destroy = vi.fn(() => this.emit("closed"));
  isDestroyed = vi.fn(() => false);
  getBounds = vi.fn(() => this.bounds);
  setPosition = vi.fn((x: number, y: number) => {
    this.bounds.x = x;
    this.bounds.y = y;
  });
  bounds = { x: 1784, y: 944, width: 120, height: 120 };
  constructor(options: { x?: number; y?: number }) {
    super();
    this.bounds.x = options.x ?? this.bounds.x;
    this.bounds.y = options.y ?? this.bounds.y;
    windows.push(this);
  }
}

vi.mock("electron", () => ({
  BrowserWindow: MockWindow,
  screen: {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => displays[0],
    getDisplayMatching: (bounds: { x: number }) =>
      displays.find(
        (d) =>
          bounds.x >= d.workArea.x &&
          bounds.x < d.workArea.x + d.workArea.width,
      ) ?? displays[0],
    on: (channel: string, fn: () => void) => screenEvents.set(channel, fn),
    removeListener: (channel: string) => removedScreenEvents.push(channel),
  },
  ipcMain: {
    on: (channel: string, fn: (...args: unknown[]) => void) =>
      ipc.set(channel, fn),
    removeListener: (channel: string) => ipc.delete(channel),
  },
}));
vi.mock("electron-store", () => ({
  default: class {
    get(key: string) {
      return storage.get(key);
    }
    set(key: string, value: unknown) {
      storage.set(key, value);
    }
  },
}));

let createPetWindowController: typeof CreateController;
let currentMain: MockWindow;
beforeAll(async () => {
  ({ createPetWindowController } =
    await import("../../main/desktop-pet/pet-window"));
});
const TWO_DISPLAYS = [
  { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
  { id: 2, workArea: { x: 1920, y: 0, width: 1920, height: 1080 } },
];

beforeEach(() => {
  windows.length = 0;
  storage.clear();
  ipc.clear();
  screenEvents.clear();
  removedScreenEvents.length = 0;
  // 每个用例都从完整的双屏布局开始：用例会拔屏或缩小工作区域。
  displays.splice(0, displays.length, ...structuredClone(TWO_DISPLAYS));
});

function enable(main: MockWindow = new MockWindow({})) {
  const controller = createPetWindowController({
    getMainWindow: () => main as never,
    tracker: new PetStateTracker(),
  });
  controller.setEnabled(true);
  return { controller, main, pet: windows[1] };
}

it("creates an independent window and restores state on load", () => {
  const main = new MockWindow({});
  const tracker = new PetStateTracker();
  tracker.start("a");
  const controller = createPetWindowController({
    getMainWindow: () => main as never,
    tracker,
  });
  controller.setEnabled(true);
  const pet = windows[1];
  expect(pet).toBeDefined();
  pet.webContents.emit("did-finish-load");
  expect(pet.webContents.send).toHaveBeenCalledWith("pet.state", "running");
  controller.setEnabled(false);
  expect(pet.destroy).toHaveBeenCalled();
  controller.dispose();
});

it("moves across displays, persists position, and rejects other senders", () => {
  const main = new MockWindow({});
  const controller = createPetWindowController({
    getMainWindow: () => main as never,
    tracker: new PetStateTracker(),
  });
  controller.setEnabled(true);
  const pet = windows[1];
  pet.bounds = { x: 1800, y: 300, width: 120, height: 120 };
  ipc.get("pet.drag")?.(
    { sender: main.webContents },
    { dx: 140, dy: 0, done: true },
  );
  expect(pet.setPosition).not.toHaveBeenCalled();
  ipc.get("pet.drag")?.(
    { sender: pet.webContents },
    { dx: 100, dy: 0, done: false },
  );
  ipc.get("pet.drag")?.(
    { sender: pet.webContents },
    { dx: 40, dy: 0, done: true },
  );
  expect(pet.setPosition).toHaveBeenCalledWith(1940, 300);
  expect(storage.get("position")).toEqual({ displayId: 2, x: 1940, y: 300 });
  ipc.get("pet.drag")?.(
    { sender: pet.webContents },
    { dx: Number.NaN, dy: 0, done: true },
  );
  ipc.get("pet.drag")?.(
    { sender: pet.webContents },
    { dx: 9000, dy: 0, done: true },
  );
  // 垃圾位移只夹取、不能丢：丢一步就会让窗口永久落后于光标。
  expect(storage.get("position")).toEqual({ displayId: 2, x: 2940, y: 300 });
  ipc.get("pet.activate")?.({ sender: pet.webContents });
  expect(main.focus).toHaveBeenCalled();
  controller.dispose();
});

it("focuses the current main window after the original one was closed", () => {
  const closed = new MockWindow({});
  const controller = createPetWindowController({
    // 主窗口关闭后会被重建，控制器必须每次向 getter 取当前窗口。
    getMainWindow: () => currentMain as never,
    tracker: new PetStateTracker(),
  });
  controller.setEnabled(true);
  const pet = windows[1];
  const reopened = new MockWindow({});
  currentMain = reopened;
  ipc.get("pet.activate")?.({ sender: pet.webContents });
  expect(reopened.focus).toHaveBeenCalled();
  expect(closed.focus).not.toHaveBeenCalled();
  controller.dispose();
});

it("falls back to the primary display's bottom-right when its display is unplugged", () => {
  const { controller, pet } = enable();
  // 桌宠在显示器 2 上，位置也已落盘（每次拖动松手都会写）。
  pet.bounds = { x: 2000, y: 500, width: 120, height: 120 };
  storage.set("position", { displayId: 2, x: 2000, y: 500 });
  displays.pop(); // 显示器 2 被拔掉，保存的位置落在已消失的屏幕上
  screenEvents.get("display-removed")?.();
  expect(pet.getBounds().x).toBe(1784);
  expect(pet.getBounds().y).toBe(944);
  expect(storage.get("position")).toEqual({ displayId: 1, x: 1784, y: 944 });
  controller.dispose();
});

it("clamps into the reduced work area of the display the pet is actually on", () => {
  const { controller, pet } = enable();
  pet.bounds = { x: 1940, y: 300, width: 120, height: 120 };
  // 保存的位置属于显示器 1，但窗口已经在显示器 2 上：只能按当前屏幕夹取。
  storage.set("position", { displayId: 1, x: 1940, y: 300 });
  displays[1].workArea = { x: 1920, y: 0, width: 800, height: 400 };
  screenEvents.get("display-metrics-changed")?.();
  expect(pet.getBounds().x).toBe(1940);
  expect(pet.getBounds().y).toBe(280);
  controller.dispose();
});

it("keeps displaying while the main window is minimized, then cleans up on dispose", () => {
  const { controller, main, pet } = enable();
  main.isMinimized = vi.fn(() => true);
  ipc.get("pet.activate")?.({ sender: pet.webContents });
  expect(main.restore).toHaveBeenCalled();
  expect(pet.destroy).not.toHaveBeenCalled();

  controller.dispose();
  expect(pet.destroy).toHaveBeenCalled();
  expect([...removedScreenEvents].sort()).toEqual([
    "display-metrics-changed",
    "display-removed",
  ]);
  expect(ipc.has("pet.activate")).toBe(false);
  expect(ipc.has("pet.drag")).toBe(false);
});

it("restores a saved position after the controller is recreated", () => {
  storage.set("position", { displayId: 2, x: 2500, y: 400 });
  const main = new MockWindow({});
  const controller = createPetWindowController({
    getMainWindow: () => main as never,
    tracker: new PetStateTracker(),
  });
  controller.setEnabled(true);
  expect(windows[1].getBounds()).toMatchObject({ x: 2500, y: 400 });
  controller.dispose();
});
