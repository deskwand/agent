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

function assertIntegerCoordinate(value: number, index: number): void {
  // 实测（electron 35，macOS）：小数、-0、NaN 都会抛同样的 conversion failure。
  // -0 也要拦：Number.isInteger(-0) 为 true，但 Electron 的 int 转换同样拒绝它。
  if (
    !Number.isInteger(value) ||
    Object.is(value, -0) ||
    !Number.isFinite(value)
  ) {
    throw new TypeError(
      `Error processing argument at index ${index}, conversion failure from`,
    );
  }
}

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
  /**
   * 真实 Electron 的 setPosition 只接受整数：小数会抛
   * `TypeError: Error processing argument at index N, conversion failure from`。
   * 实测（electron 35，macOS）：setPosition(100, 150.5) 抛 index 1。
   * 假窗口必须复现这个契约，否则“坐标是小数”这类崩溃在单测里看不见。
   */
  setPosition = vi.fn((x: number, y: number) => {
    assertIntegerCoordinate(x, 0);
    assertIntegerCoordinate(y, 1);
    this.bounds.x = x;
    this.bounds.y = y;
  });
  bounds = { x: 1784, y: 944, width: 72, height: 72 };
  options: Electron.BrowserWindowConstructorOptions = {};
  constructor(options: Electron.BrowserWindowConstructorOptions) {
    super();
    this.options = options;
    // 注意：真实 BrowserWindow 构造器对小数 x/y 不报错，而是静默忽略并居中；
    // 这里不模拟那个行为，所以构造器不断言坐标，只验证真实的 setPosition 契约。
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
    getCharacter: () => "lens",
    onSelectCharacter: () => {},
    tracker: new PetStateTracker(),
  });
  controller.setEnabled(true);
  return { controller, main, pet: windows[1] };
}

it("pushes a newly selected character to the live window", () => {
  const main = new MockWindow({});
  const controller = createPetWindowController({
    getMainWindow: () => main as never,
    tracker: new PetStateTracker(),
    getCharacter: () => "lens",
    onSelectCharacter: () => {},
  });
  controller.setEnabled(true);
  const pet = windows[1];
  pet.webContents.send.mockClear();
  controller.setCharacter("ghost");
  // 选中即生效：改角色必须把新值推给活着的窗口，而不是等下次重建。
  expect(pet.webContents.send).toHaveBeenCalledWith("pet.character", "ghost");
  controller.setCharacter("lens");
  expect(pet.webContents.send).toHaveBeenLastCalledWith(
    "pet.character",
    "lens",
  );
  controller.dispose();
});

it("pushes the current character on load", () => {
  const main = new MockWindow({});
  const controller = createPetWindowController({
    getMainWindow: () => main as never,
    tracker: new PetStateTracker(),
    // 用非默认值，断言才有意义（默认值会让"没发也过"）。
    getCharacter: () => "ghost",
    onSelectCharacter: () => {},
  });
  controller.setEnabled(true);
  const pet = windows[1];
  pet.webContents.emit("did-finish-load");
  expect(pet.webContents.send).toHaveBeenCalledWith("pet.character", "ghost");
  controller.dispose();
});

it("creates an independent window and restores state on load", () => {
  const main = new MockWindow({});
  const tracker = new PetStateTracker();
  tracker.start("a");
  const controller = createPetWindowController({
    getMainWindow: () => main as never,
    getCharacter: () => "lens",
    onSelectCharacter: () => {},
    tracker,
  });
  controller.setEnabled(true);
  const pet = windows[1];
  expect(pet).toBeDefined();
  pet.webContents.emit("did-finish-load");
  expect(pet.webContents.send).toHaveBeenCalledWith("pet.state", "running");
  // 角色与状态一起下发；顺序不重要，重要的是两个都发了。
  expect(pet.webContents.send).toHaveBeenCalledWith("pet.character", "lens");
  controller.setEnabled(false);
  expect(pet.destroy).toHaveBeenCalled();
  controller.dispose();
});

it("moves across displays, persists position, and rejects other senders", () => {
  const main = new MockWindow({});
  const controller = createPetWindowController({
    getMainWindow: () => main as never,
    getCharacter: () => "lens",
    onSelectCharacter: () => {},
    tracker: new PetStateTracker(),
  });
  controller.setEnabled(true);
  const pet = windows[1];
  pet.bounds = { x: 1800, y: 300, width: 72, height: 72 };
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
    getCharacter: () => "lens",
    onSelectCharacter: () => {},
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
  pet.bounds = { x: 2000, y: 500, width: 72, height: 72 };
  storage.set("position", { displayId: 2, x: 2000, y: 500 });
  displays.pop(); // 显示器 2 被拔掉，保存的位置落在已消失的屏幕上
  screenEvents.get("display-removed")?.();
  // 主显示器工作区域右下角，留 16px 边距：1920-72-16, 1080-72-16。
  expect(pet.getBounds().x).toBe(1832);
  expect(pet.getBounds().y).toBe(992);
  expect(storage.get("position")).toEqual({ displayId: 1, x: 1832, y: 992 });
  controller.dispose();
});

it("clamps into the reduced work area of the display the pet is actually on", () => {
  const { controller, pet } = enable();
  pet.bounds = { x: 1940, y: 300, width: 72, height: 72 };
  // 保存的位置属于显示器 1，但窗口已经在显示器 2 上：只能按当前屏幕夹取。
  storage.set("position", { displayId: 1, x: 1940, y: 300 });
  displays[1].workArea = { x: 1920, y: 0, width: 800, height: 340 };
  screenEvents.get("display-metrics-changed")?.();
  expect(pet.getBounds().x).toBe(1940);
  // 340 - 72 = 268：超出缩小后的工作区域，被夹回来。
  expect(pet.getBounds().y).toBe(268);
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

it("rounds fractional drag deltas before moving the window", () => {
  const { controller, pet } = enable();
  pet.bounds = { x: 1800, y: 300, width: 72, height: 72 };
  // macOS 的 PointerEvent.screenX/Y 可以是小数：直接相加会撞上只收整数的
  // setPosition，主进程抛未捕获异常。
  ipc.get("pet.drag")?.(
    { sender: pet.webContents },
    { dx: 0.5, dy: 0.25, done: false },
  );
  ipc.get("pet.drag")?.(
    { sender: pet.webContents },
    { dx: 12.5, dy: 8.75, done: true },
  );
  for (const call of pet.setPosition.mock.calls) {
    expect(Number.isInteger(call[0])).toBe(true);
    expect(Number.isInteger(call[1])).toBe(true);
  }
  // 理想终点 (1813, 309)；每次取整最多丢 <1px，且不累积。
  expect(Math.abs(pet.getBounds().x - 1813)).toBeLessThanOrEqual(1);
  expect(Math.abs(pet.getBounds().y - 309)).toBeLessThanOrEqual(1);
  controller.dispose();
});

it("rounds fractional work areas before placing the window", () => {
  // 缩放显示器上 workArea 可以是小数，回退位置也会是小数。
  displays[0].workArea = { x: 0, y: 0, width: 1920, height: 1079.5 };
  const { controller, pet } = enable();
  expect(Number.isInteger(pet.getBounds().x)).toBe(true);
  expect(Number.isInteger(pet.getBounds().y)).toBe(true);
  controller.dispose();
});

it("normalizes negative zero so a drag past the left edge cannot crash", () => {
  const { controller, pet } = enable();
  // 窗口可以暂时越出屏幕左缘（未松手前不做夹取）：-1 + 0.5 = -0.5
  // → Math.round 得到 -0 → Electron 的 int 转换抛未捕获异常。
  pet.bounds = { x: -1, y: 300, width: 72, height: 72 };
  ipc.get("pet.drag")?.(
    { sender: pet.webContents },
    { dx: 0.5, dy: 0, done: false },
  );
  expect(Object.is(pet.getBounds().x, -0)).toBe(false);
  expect(pet.getBounds().x).toBe(0);
  controller.dispose();
});

it("keeps the sub-pixel part of slow drags instead of dropping it", () => {
  const { controller, pet } = enable();
  pet.bounds = { x: 1800, y: 300, width: 72, height: 72 };
  // 高刷新率触控板上一小步可能不到 1px：每次都丢掉余量的话窗口会原地不动。
  for (let i = 0; i < 10; i += 1) {
    ipc.get("pet.drag")?.(
      { sender: pet.webContents },
      { dx: 0.4, dy: 0, done: false },
    );
  }
  expect(pet.getBounds().x).toBe(1804);
  controller.dispose();
});

it("ignores a corrupted saved position instead of crashing", () => {
  storage.set("position", { displayId: 1, x: Number.NaN, y: 5 });
  const { controller, pet } = enable();
  expect(pet.getBounds().x).toBe(1832);
  expect(pet.getBounds().y).toBe(992);
  controller.dispose();
});

it("re-anchors when the window moved outside the drag (e.g. the OS clamped it)", () => {
  const { controller, pet } = enable();
  pet.bounds = { x: 200, y: 300, width: 72, height: 72 };
  ipc.get("pet.drag")?.(
    { sender: pet.webContents },
    { dx: 50, dy: 0, done: false },
  );
  expect(pet.getBounds().x).toBe(250);
  // 拖动中窗口被外部移动（macOS 会把越屏坐标夹回可见区域）。
  pet.bounds = { x: 900, y: 300, width: 72, height: 72 };
  ipc.get("pet.drag")?.(
    { sender: pet.webContents },
    { dx: 10, dy: 0, done: true },
  );
  expect(pet.getBounds().x).toBe(910);
  controller.dispose();
});

it("restores a saved position after the controller is recreated", () => {
  storage.set("position", { displayId: 2, x: 2500, y: 400 });
  const main = new MockWindow({});
  const controller = createPetWindowController({
    getMainWindow: () => main as never,
    getCharacter: () => "lens",
    onSelectCharacter: () => {},
    tracker: new PetStateTracker(),
  });
  controller.setEnabled(true);
  expect(windows[1].getBounds()).toMatchObject({ x: 2500, y: 400 });
  controller.dispose();
});

it("stays out of fullscreen so a fullscreen main window cannot stretch it", () => {
  const { controller, pet } = enable();
  // macOS 会把「主窗口全屏时新显示的窗口」一起全屏（electron#32374/#39614）：
  // fullscreenable 默认 true 的话，72px 的桌宠会被拉成整屏的椭圆。
  expect(pet.options.fullscreenable).toBe(false);
  controller.dispose();
});
