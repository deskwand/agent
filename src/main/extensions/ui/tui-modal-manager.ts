import { TUI, getKeybindings, type Component } from "@earendil-works/pi-tui";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { VirtualTerminal } from "./virtual-terminal";
import { createNoopTheme } from "./theme-utils";

/** Component 的可选 dispose 契约（SDK factory 返回类型允许）。 */
function disposeComponent(component: Component | undefined): void {
  (component as { dispose?: () => void } | undefined)?.dispose?.();
}

export interface TuiModalManagerCallbacks {
  onOpen: (options: { width: number; height: number; title?: string }) => void;
  onClose: () => void;
  onFrame: (ansiChunk: string) => void;
  onWidgets: (widgets: Array<{ key: string; lines: string[] }>) => void;
  onTitleChange: (title: string) => void;
}

export type ModalComponentFactory<T> = (
  tui: TUI,
  theme: Theme,
  keybindings: ReturnType<typeof getKeybindings>,
  done: (result: T) => void,
) => Component | Promise<Component>;

export class TuiModalManager {
  readonly terminal: VirtualTerminal;
  private tui: TUI | undefined;
  private readonly theme: Theme;
  private pendingDone: ((value: unknown) => void) | undefined;
  private activeComponent: Component | undefined;
  private widgetComponents = new Map<string, Component>();

  constructor(private readonly callbacks: TuiModalManagerCallbacks) {
    // spike 关键发现：官方组件（BorderedLoader 等）依赖全局主题初始化
    initTheme("dark");
    this.theme = createNoopTheme();
    this.terminal = new VirtualTerminal({
      onFrame: (chunk) => this.callbacks.onFrame(chunk),
      onResizeRequest: () => {},
      onTitleChange: (title) => this.callbacks.onTitleChange(title),
    });
  }

  private ensureTui(): TUI {
    if (!this.tui) {
      this.tui = new TUI(this.terminal);
      this.tui.start();
      for (const component of this.widgetComponents.values()) {
        this.tui.addChild(component);
      }
    }
    return this.tui;
  }

  openCustom<T>(factory: ModalComponentFactory<T>): Promise<T> {
    const tui = this.ensureTui();
    return new Promise<T>((resolve) => {
      if (this.pendingDone) {
        // 并发 custom()：拒绝新调用（P1 语义：串行 UI）
        console.warn("[TuiModalManager] custom() called while another is active");
        resolve(undefined as unknown as T);
        return;
      }
      this.pendingDone = resolve as (value: unknown) => void;
      this.callbacks.onOpen({
        width: this.terminal.columns,
        height: this.terminal.rows,
      });
      const finish = (result: T) => {
        if (this.pendingDone) {
          this.pendingDone = undefined;
        }
        this.unmountActiveComponent();
        this.callbacks.onClose();
        resolve(result);
      };
      const componentPromise = Promise.resolve(
        factory(tui, this.theme, getKeybindings(), finish),
      );
      void componentPromise.then((component) => {
        // done 同步调用时（工厂内直接 finish），不再挂载已关闭的组件
        if (this.pendingDone === undefined) {
          disposeComponent(component);
          return;
        }
        this.activeComponent = component;
        tui.addChild(component);
        tui.setFocus(component);
        tui.requestRender();
      });
    });
  }

  closeCurrent(): void {
    const resolve = this.pendingDone;
    this.pendingDone = undefined;
    if (resolve) {
      this.unmountActiveComponent();
      this.callbacks.onClose();
      resolve(undefined);
    }
  }

  private unmountActiveComponent(): void {
    const component = this.activeComponent;
    this.activeComponent = undefined;
    if (component && this.tui) {
      this.tui.removeChild(component);
      disposeComponent(component);
      this.tui.requestRender();
    }
  }

  setWidget(
    key: string,
    factory: ((tui: TUI, theme: Theme) => Component) | undefined,
  ): void {
    const existing = this.widgetComponents.get(key);
    if (existing && this.tui) {
      this.tui.removeChild(existing);
      disposeComponent(existing);
    }
    if (!factory) {
      this.widgetComponents.delete(key);
      this.pushWidgets();
      return;
    }
    const component = factory(this.ensureTui(), this.theme);
    this.widgetComponents.set(key, component);
    this.tui?.addChild(component);
    this.tui?.requestRender();
    this.pushWidgets();
  }

  private pushWidgets(): void {
    // string[] 形式由 bridge 直接走 React 通道；
    // factory 组件保留在 TUI 内渲染，此处仅通知（占位）。
    this.callbacks.onWidgets([]);
  }

  setModalSize(columns: number, rows: number): void {
    this.terminal.setSize(columns, rows);
    this.tui?.requestRender(true);
  }

  injectInput(data: string): void {
    this.terminal.injectInput(data);
  }

  dispose(): void {
    this.closeCurrent();
    for (const [key, component] of [...this.widgetComponents]) {
      this.tui?.removeChild(component);
      disposeComponent(component);
      this.widgetComponents.delete(key);
    }
    this.tui?.stop();
    this.tui = undefined;
    this.terminal.stop();
  }
}
