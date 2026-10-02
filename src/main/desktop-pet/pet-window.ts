import { BrowserWindow, ipcMain, screen } from "electron";
import Store from "electron-store";
import { join } from "node:path";
import { logError } from "../utils/logger";
import type { PetCharacter } from "../../shared/pet-characters";
import type { PetStateTracker } from "./pet-state";
import { openPetCharacterMenu } from "./pet-menu";
import {
  clampToDisplay,
  restorePosition,
  type PetDisplay,
  type PetPosition,
} from "./pet-position";

const SIZE = 72;

/**
 * Electron 的 `BrowserWindow.setPosition` 只收真正的整数：小数会抛
 * `TypeError: Error processing argument at index N, conversion failure from`，
 * 而且是主进程未捕获异常（弹“A JavaScript error occurred in the main process”）。
 * 实测（electron 35，macOS）：`-0` 与 `NaN` 同样被拒，`-0` 尤其阴——
 * `Math.round(-0.5)` 就是 `-0`，而 `Number.isInteger(-0)` 为 true。
 * 渲染层的 `PointerEvent.screenX/Y` 与缩放显示器上的 `workArea` 都可能是小数，
 * 所以所有交给 Electron 的坐标都在这里归一化。
 */
function toWindowCoordinate(value: number): number {
  const rounded = Math.round(value);
  // -0 → 0：算术上相等，但 Electron 的 int 转换不认。
  return rounded === 0 ? 0 : rounded;
}

function toWindowPoint(point: { x: number; y: number }): {
  x: number;
  y: number;
} {
  return { x: toWindowCoordinate(point.x), y: toWindowCoordinate(point.y) };
}

/** 保存的位置可能被外部改坏：非有限值当作没保存过，不能让 NaN 流到 Electron。 */
function isValidStoredPosition(
  value: PetPosition | undefined,
): value is PetPosition {
  return Boolean(value && Number.isFinite(value.x) && Number.isFinite(value.y));
}

/**
 * 单次拖动位移的上限。这不是安全边界（连续小步同样能把窗口拖到任何位置），
 * 只是拒绝渲染层送来的垃圾数值。所以超限时夹取而不是丢弃：丢弃会让窗口
 * 永久落后于光标——渲染层每次都推进自己的基准点，丢掉的那一段再也补不回来。
 */
const MAX_DRAG_STEP = 1000;

export interface PetWindowController {
  setEnabled(enabled: boolean): void;
  setCharacter(character: PetCharacter): void;
  dispose(): void;
}

export function createPetWindowController({
  getMainWindow,
  tracker,
  getCharacter,
  onSelectCharacter,
}: {
  /** 主窗口关闭后会被重建，因此每次点击都取当前窗口，不能保存旧引用。 */
  getMainWindow: () => BrowserWindow | null;
  tracker: PetStateTracker;
  getCharacter: () => PetCharacter;
  /** 菜单选中角色后的回写（写配置 + 下发窗口）：唯一的生产调用方是 index.ts，必填以免漏接线后静默失效。 */
  onSelectCharacter: (character: PetCharacter) => void;
}): PetWindowController {
  const positions = new Store<{ position?: PetPosition }>({
    name: "desktop-pet-position",
  });
  let petWindow: BrowserWindow | null = null;
  let unsubscribe: (() => void) | null = null;
  /**
   * 拖动中的位置：`exact` 是浮点精确值（累加余量，不丢亚像素），
   * `applied` 是上一次真正写进窗口的整数位置。
   */
  let dragExact: { x: number; y: number } | null = null;
  let dragApplied: { x: number; y: number } | null = null;
  const displays = () => screen.getAllDisplays() as PetDisplay[];
  const savedPosition = () => {
    const stored = positions.get("position");
    return isValidStoredPosition(stored) ? stored : undefined;
  };

  const keepVisible = (fallbackOnMissing = false) => {
    if (!petWindow || petWindow.isDestroyed()) return;
    dragExact = null;
    dragApplied = null;
    const saved = savedPosition();
    const current = petWindow.getBounds();
    const present = saved && displays().some((d) => d.id === saved.displayId);
    // 窗口现在在哪块屏就按哪块屏夹取：保存的位置可能过期（例如拖动中途退出），
    // 拿它当夹取目标会把窗口从当前屏幕弹回去。
    const currentDisplay = screen.getDisplayMatching({
      ...current,
      width: SIZE,
      height: SIZE,
    });
    const rounded = toWindowPoint(
      restorePosition(
        fallbackOnMissing && saved && !present
          ? undefined
          : { displayId: currentDisplay.id, x: current.x, y: current.y },
        SIZE,
        displays(),
      ),
    );
    petWindow.setPosition(rounded.x, rounded.y);
    const display = screen.getDisplayMatching({
      ...rounded,
      width: SIZE,
      height: SIZE,
    });
    positions.set("position", { displayId: display.id, ...rounded });
  };
  const onDisplayChange = () => keepVisible(true);
  screen.on("display-removed", onDisplayChange);
  screen.on("display-metrics-changed", onDisplayChange);

  const onActivate = (event: Electron.IpcMainEvent) => {
    if (event.sender !== petWindow?.webContents) return;
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };
  const onDrag = (
    event: Electron.IpcMainEvent,
    delta: { dx: number; dy: number; done: boolean },
  ) => {
    if (
      event.sender !== petWindow?.webContents ||
      !petWindow ||
      !Number.isFinite(delta?.dx) ||
      !Number.isFinite(delta?.dy)
    )
      return;
    // 桌宠是装饰窗口，绝不能因为一次坐标问题把主进程变成
    // “A JavaScript error occurred in the main process”弹窗。
    // 归一化才是修复，这里的 try/catch 只把未知的同类问题降级成一条日志。
    try {
      const clampStep = (value: number) =>
        Math.max(-MAX_DRAG_STEP, Math.min(MAX_DRAG_STEP, value));
      const bounds = petWindow.getBounds();
      // 窗口不在我们上次放的位置上，说明它被别的东西移动过（macOS 会把越出
      // 屏幕的坐标夹回可见区域，keepVisible 也可能挪动它）。此时旧锚点已失效，
      // 继续拿它累加会让窗口在下次拖动时跳回原位。
      if (
        dragExact &&
        dragApplied &&
        (bounds.x !== dragApplied.x || bounds.y !== dragApplied.y)
      ) {
        dragExact = null;
      }
      const exact = dragExact ?? { x: bounds.x, y: bounds.y };
      const next = {
        x: exact.x + clampStep(delta.dx),
        y: exact.y + clampStep(delta.dy),
      };
      const applied = toWindowPoint(next);
      petWindow.setPosition(applied.x, applied.y);
      if (delta.done) {
        dragExact = null;
        dragApplied = null;
        const display = screen.getDisplayMatching({
          ...applied,
          width: SIZE,
          height: SIZE,
        });
        const clamped = toWindowPoint(clampToDisplay(applied, SIZE, display));
        petWindow.setPosition(clamped.x, clamped.y);
        positions.set("position", { displayId: display.id, ...clamped });
      } else {
        dragExact = next;
        dragApplied = applied;
      }
    } catch (error) {
      dragExact = null;
      dragApplied = null;
      logError("[DesktopPet] drag failed:", error);
    }
  };
  const onOpenMenu = (event: Electron.IpcMainEvent) => {
    if (event.sender !== petWindow?.webContents || !petWindow) return;
    openPetCharacterMenu({
      window: petWindow,
      // 当前值以配置为准，不信渲染层。
      current: getCharacter(),
      onSelect: onSelectCharacter,
    });
  };
  ipcMain.on("pet.activate", onActivate);
  ipcMain.on("pet.drag", onDrag);
  ipcMain.on("pet.menu", onOpenMenu);

  const setCharacter = (character: PetCharacter) => {
    if (!petWindow || petWindow.isDestroyed()) return;
    petWindow.webContents.send("pet.character", character);
  };

  const setEnabled = (enabled: boolean) => {
    if (!enabled) {
      unsubscribe?.();
      unsubscribe = null;
      dragExact = null;
      dragApplied = null;
      petWindow?.destroy();
      petWindow = null;
      return;
    }
    if (petWindow && !petWindow.isDestroyed()) return;
    const position = toWindowPoint(
      restorePosition(savedPosition(), SIZE, displays()),
    );
    const window = new BrowserWindow({
      width: SIZE,
      height: SIZE,
      x: position.x,
      y: position.y,
      transparent: true,
      frame: false,
      // 透明窗口默认的系统阴影是矩形，会在圆镜头四角露出方块。
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      // macOS：主窗口处于原生全屏时 show() 一个新窗口，只要它的 fullscreenable
      // 还是默认的 true，macOS 就会把它一起全屏（electron#32374 / #39614，
      // electron 35 实测仍复现），72px 的桌宠会被拉成整屏。resizable: false 挡不住它。
      fullscreenable: false,
      show: false,
      webPreferences: {
        preload: join(__dirname, "../preload/pet.js"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    petWindow = window;
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.on("did-finish-load", () => {
      window.webContents.send("pet.state", tracker.snapshot());
      window.webContents.send("pet.character", getCharacter());
      window.showInactive();
    });
    // 加载失败也要留线索：窗口默认不显示，否则只会是一个静默的空窗。
    window.webContents.on("did-fail-load", (_event, code, description) => {
      logError("[DesktopPet] pet window failed to load:", code, description);
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      logError("[DesktopPet] pet window renderer gone:", details.reason);
    });
    unsubscribe = tracker.subscribe((state) => {
      if (!window.isDestroyed()) window.webContents.send("pet.state", state);
    });
    if (process.env.VITE_DEV_SERVER_URL) {
      void window.loadURL(`${process.env.VITE_DEV_SERVER_URL}pet.html`);
    } else {
      void window.loadFile(join(__dirname, "../../dist/pet.html"));
    }
  };
  return {
    setEnabled,
    setCharacter,
    dispose() {
      setEnabled(false);
      screen.removeListener("display-removed", onDisplayChange);
      screen.removeListener("display-metrics-changed", onDisplayChange);
      ipcMain.removeListener("pet.activate", onActivate);
      ipcMain.removeListener("pet.drag", onDrag);
      ipcMain.removeListener("pet.menu", onOpenMenu);
    },
  };
}
