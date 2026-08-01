import {
  createPiUiBridge,
  type PiUiBridge,
  type UiBridgeCallbacks,
} from "./bridge";
import { TuiModalManager } from "./tui-modal-manager";

export interface PiUiRuntimeCallbacks {
  sendEvent: (type: string, payload: unknown) => void;
  setWindowTitle: (title: string) => void;
  /** 扩展 setEditorText：写入聊天输入框（renderer 消费）。 */
  setEditorText: (text: string) => void;
}

let bridge: PiUiBridge | undefined;
let modalManager: TuiModalManager | undefined;

/**
 * 进程级 Pi 扩展 UI 运行时单例。
 * main/index.ts 启动时调用 initPiUiRuntime() 初始化；
 * agent-runner 会话创建后经 getPiUiBridge() 绑定到 bindExtensions。
 */
export function initPiUiRuntime(callbacks: PiUiRuntimeCallbacks): {
  bridge: PiUiBridge;
  modalManager: TuiModalManager;
} {
  const manager = new TuiModalManager({
    onOpen: (opts) => callbacks.sendEvent("pi.tui.open", opts),
    onClose: () => callbacks.sendEvent("pi.tui.close", {}),
    onFrame: (chunk) => callbacks.sendEvent("pi.tui.frame", { chunk }),
    onWidgets: () => {},
    onTitleChange: (title) => callbacks.setWindowTitle(title),
  });
  const uiCallbacks: UiBridgeCallbacks = {
    dialog: (request) => {
      // renderer 响应经 pi-ui.response 回填；无响应 60s 超时兜底在 main 接线层
      return new Promise((resolve) => {
        callbacks.sendEvent("pi.ui-request", request);
        // 由 main 层的 piUiPending 注册 resolve；此处先返回一个可替换的 promise
        pendingDialogs.set(request.id, resolve);
      });
    },
    notify: (message, type) => callbacks.sendEvent("pi.notify", { message, type }),
    setStatus: (key, text) => callbacks.sendEvent("pi.set-status", { key, text }),
    setWidgetText: (key, lines) => callbacks.sendEvent("pi.set-widget", { key, lines }),
    setTitle: (title) => callbacks.setWindowTitle(title),
    setEditorText: (text) => callbacks.setEditorText(text),
    getEditorText: () => "",
    setWorking: () => {},
    setThinkingLabel: () => {},
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  };
  bridge = createPiUiBridge(uiCallbacks, { getModalManager: () => manager });
  modalManager = manager;
  return { bridge, modalManager };
}

/** main 层 pi-ui.response IPC 的 resolve 注册表（与 dialog 回调协作）。 */
export const pendingDialogs = new Map<string, (result: unknown) => void>();

export function resolveUiDialog(id: string, result: unknown): boolean {
  const resolve = pendingDialogs.get(id);
  if (resolve) {
    pendingDialogs.delete(id);
    resolve(result);
    return true;
  }
  return false;
}

export function getPiUiBridge(): PiUiBridge | undefined {
  return bridge;
}

export function getPiTuiModalManager(): TuiModalManager | undefined {
  return modalManager;
}

/** 会话关闭/切换时：关闭 TUI Modal、清空终端输入订阅。 */
export function resetUiState(): void {
  modalManager?.closeCurrent();
  bridge?.resetTerminalInputHandlers();
}

export function injectTuiInput(data: string): void {
  modalManager?.injectInput(data);
}

export function resizeTuiModal(columns: number, rows: number): void {
  modalManager?.setModalSize(columns, rows);
}

/** Modal 焦点期间的按键同时转发给 onTerminalInput 订阅者。 */
export function notifyTerminalInput(data: string): void {
  bridge?.notifyTerminalInput(data);
}
