import { BrowserWindow, ipcMain, screen } from "electron";
import Store from "electron-store";
import { join } from "node:path";
import { logError } from "../utils/logger";
import type { PetStateTracker } from "./pet-state";
import {
  clampToDisplay,
  restorePosition,
  type PetDisplay,
  type PetPosition,
} from "./pet-position";

const SIZE = 120;

/**
 * 单次拖动位移的上限。这不是安全边界（连续小步同样能把窗口拖到任何位置），
 * 只是拒绝渲染层送来的垃圾数值。所以超限时夹取而不是丢弃：丢弃会让窗口
 * 永久落后于光标——渲染层每次都推进自己的基准点，丢掉的那一段再也补不回来。
 */
const MAX_DRAG_STEP = 1000;

export interface PetWindowController {
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

export function createPetWindowController({
  getMainWindow,
  tracker,
}: {
  /** 主窗口关闭后会被重建，因此每次点击都取当前窗口，不能保存旧引用。 */
  getMainWindow: () => BrowserWindow | null;
  tracker: PetStateTracker;
}): PetWindowController {
  const positions = new Store<{ position?: PetPosition }>({
    name: "desktop-pet-position",
  });
  let petWindow: BrowserWindow | null = null;
  let unsubscribe: (() => void) | null = null;
  const displays = () => screen.getAllDisplays() as PetDisplay[];

  const keepVisible = (fallbackOnMissing = false) => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const saved = positions.get("position");
    const current = petWindow.getBounds();
    const present = saved && displays().some((d) => d.id === saved.displayId);
    // 窗口现在在哪块屏就按哪块屏夹取：保存的位置可能过期（例如拖动中途退出），
    // 拿它当夹取目标会把窗口从当前屏幕弹回去。
    const currentDisplay = screen.getDisplayMatching({
      ...current,
      width: SIZE,
      height: SIZE,
    });
    const next = restorePosition(
      fallbackOnMissing && saved && !present
        ? undefined
        : { displayId: currentDisplay.id, x: current.x, y: current.y },
      SIZE,
      displays(),
    );
    petWindow.setPosition(next.x, next.y);
    const display = screen.getDisplayMatching({
      ...next,
      width: SIZE,
      height: SIZE,
    });
    positions.set("position", { displayId: display.id, ...next });
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
    const clampStep = (value: number) =>
      Math.max(-MAX_DRAG_STEP, Math.min(MAX_DRAG_STEP, value));
    const bounds = petWindow.getBounds();
    const next = {
      x: bounds.x + clampStep(delta.dx),
      y: bounds.y + clampStep(delta.dy),
    };
    petWindow.setPosition(next.x, next.y);
    if (delta.done) {
      const display = screen.getDisplayMatching({
        ...next,
        width: SIZE,
        height: SIZE,
      });
      const clamped = clampToDisplay(next, SIZE, display);
      petWindow.setPosition(clamped.x, clamped.y);
      positions.set("position", { displayId: display.id, ...clamped });
    }
  };
  ipcMain.on("pet.activate", onActivate);
  ipcMain.on("pet.drag", onDrag);

  const setEnabled = (enabled: boolean) => {
    if (!enabled) {
      unsubscribe?.();
      unsubscribe = null;
      petWindow?.destroy();
      petWindow = null;
      return;
    }
    if (petWindow && !petWindow.isDestroyed()) return;
    const position = restorePosition(
      positions.get("position"),
      SIZE,
      displays(),
    );
    const window = new BrowserWindow({
      width: SIZE,
      height: SIZE,
      x: position.x,
      y: position.y,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
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
    dispose() {
      setEnabled(false);
      screen.removeListener("display-removed", onDisplayChange);
      screen.removeListener("display-metrics-changed", onDisplayChange);
      ipcMain.removeListener("pet.activate", onActivate);
      ipcMain.removeListener("pet.drag", onDrag);
    },
  };
}
