import type { Theme} from "@earendil-works/pi-coding-agent";
import { type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { createNoopTheme } from "./theme-utils";
import type { TuiModalManager } from "./tui-modal-manager";

export interface PiUiRequest {
  type: "extension_ui_request";
  id: string;
  method: "select" | "confirm" | "input" | "editor";
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  timeout?: number;
}

export interface UiBridgeCallbacks {
  dialog: (request: PiUiRequest) => Promise<unknown>;
  notify: (message: string, type: "info" | "warning" | "error") => void;
  setStatus: (key: string, text: string | undefined) => void;
  setWidgetText: (key: string, lines: string[] | undefined) => void;
  setTitle: (title: string) => void;
  setEditorText: (text: string) => void;
  getEditorText: () => string;
  setWorking: (message?: string) => void;
  setThinkingLabel: (label?: string) => void;
  getToolsExpanded: () => boolean;
  setToolsExpanded: (expanded: boolean) => void;
}

export interface PiBridgeOptions {
  /** P1 起提供：custom()/setWidget(factory)/onTerminalInput 的 TUI Modal 宿主。 */
  getModalManager?: () => TuiModalManager | undefined;
}

let requestSeq = 0;

let cachedTheme: Theme | undefined;

function resolveTheme(): Theme {
  if (!cachedTheme) {
    cachedTheme = createNoopTheme();
  }
  return cachedTheme;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  defaultValue: T,
): Promise<T> {
  if (!timeoutMs) return promise;
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(defaultValue), timeoutMs)),
  ]);
}

export interface PiUiBridge extends ExtensionUIContext {
  /** main 接线用：把 Modal 焦点期间的按键转发给 onTerminalInput 订阅者。 */
  notifyTerminalInput(data: string): void;
  /** 会话关闭时清空 onTerminalInput 订阅（防跨会话泄漏）。 */
  resetTerminalInputHandlers(): void;
}

export function createPiUiBridge(
  callbacks: UiBridgeCallbacks,
  options?: PiBridgeOptions,
): PiUiBridge {
  const getModalManager = options?.getModalManager;
  const terminalInputHandlers = new Set<(data: string) => void>();

  const dialog = async (
    method: PiUiRequest["method"],
    title: string,
    extra: Partial<PiUiRequest>,
    timeout?: number,
  ): Promise<unknown> => {
    const request: PiUiRequest = {
      type: "extension_ui_request",
      id: `pi-ui-${++requestSeq}`,
      method,
      title,
      ...extra,
      timeout,
    };
    const promise = callbacks.dialog(request);
    if (method === "confirm") {
      return withTimeout(promise as Promise<boolean>, timeout, false);
    }
    return withTimeout(promise, timeout, undefined);
  };

  const bridge: PiUiBridge = {
    select: (title, options, opts) =>
      dialog("select", title, { options }, opts?.timeout) as Promise<
        string | undefined
      >,
    confirm: (title, message, opts) =>
      dialog("confirm", title, { message }, opts?.timeout) as Promise<boolean>,
    input: (title, placeholder, opts) =>
      dialog("input", title, { placeholder }, opts?.timeout) as Promise<
        string | undefined
      >,
    editor: (title, prefill) =>
      dialog("editor", title, { prefill }) as Promise<string | undefined>,
    notify: (message, type) => callbacks.notify(message, type ?? "info"),
    onTerminalInput: (handler) => {
      terminalInputHandlers.add(handler);
      return () => terminalInputHandlers.delete(handler);
    },
    setStatus: (key, text) => callbacks.setStatus(key, text),
    setWorkingMessage: (message) => callbacks.setWorking(message),
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: (label) => callbacks.setThinkingLabel(label),
    setWidget: (key, content) => {
      if (Array.isArray(content)) {
        // string[] 形式走 React 通道
        callbacks.setWidgetText(key, content);
        return;
      }
      // component factory 形式走 TUI Modal（P1）
      const manager = getModalManager?.();
      if (manager) {
        manager.setWidget(key, content as never);
      }
    },
    setFooter: () => {},
    setHeader: () => {},
    setTitle: (title) => callbacks.setTitle(title),
    custom: ((factory: unknown) => {
      const manager = getModalManager?.();
      if (manager) {
        return manager.openCustom(factory as never);
      }
      return Promise.resolve(undefined);
    }) as PiUiBridge["custom"],
    pasteToEditor: (text) => callbacks.setEditorText(text),
    setEditorText: (text) => callbacks.setEditorText(text),
    getEditorText: () => callbacks.getEditorText(),
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    theme: resolveTheme(),
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({
      success: false,
      error: "Theme switching is not supported in this mode",
    }),
    getToolsExpanded: () => callbacks.getToolsExpanded(),
    setToolsExpanded: (expanded) => callbacks.setToolsExpanded(expanded),
    notifyTerminalInput: (data) => {
      for (const handler of terminalInputHandlers) {
        handler(data);
      }
    },
    resetTerminalInputHandlers: () => {
      terminalInputHandlers.clear();
    },
  };

  return bridge;
}
