import type { Terminal } from "@earendil-works/pi-tui";
import { AnsiScreenBuffer } from "./ansi-screen";

export interface VirtualTerminalCallbacks {
  onFrame: (ansiChunk: string) => void;
  onResizeRequest: (columns: number, rows: number) => void;
  onTitleChange: (title: string) => void;
}

const FRAME_INTERVAL_MS = 16;

export class VirtualTerminal implements Terminal {
  private pending = "";
  private frameTimer: NodeJS.Timeout | undefined;
  private inputHandler: ((data: string) => void) | null = null;
  private resizeHandler: (() => void) | null = null;
  private _columns = 80;
  private _rows = 24;
  private _kittyProtocolActive = false;
  private readonly screen = new AnsiScreenBuffer();

  constructor(private readonly callbacks: VirtualTerminalCallbacks) {}

  setSize(columns: number, rows: number): void {
    this._columns = Math.max(10, Math.floor(columns));
    this._rows = Math.max(3, Math.floor(rows));
    this.resizeHandler?.();
    this.callbacks.onResizeRequest(this._columns, this._rows);
  }

  setInputHandler(handler: ((data: string) => void) | null): void {
    this.inputHandler = handler;
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.inputHandler = onInput;
    this.resizeHandler = onResize;
  }

  stop(): void {
    if (this.frameTimer) {
      clearTimeout(this.frameTimer);
      this.frameTimer = undefined;
    }
    this.flushNow();
  }

  drainInput(): Promise<void> {
    return Promise.resolve();
  }

  write(data: string): void {
    this.pending += data;
    if (!this.frameTimer) {
      this.frameTimer = setTimeout(() => this.flushNow(), FRAME_INTERVAL_MS);
    }
  }

  flushNow(): void {
    if (this.frameTimer) {
      clearTimeout(this.frameTimer);
      this.frameTimer = undefined;
    }
    if (this.pending) {
      const chunk = this.pending;
      this.pending = "";
      // 差分输出经屏幕缓冲解析为完整屏幕文本，renderer 直接替换显示
      this.callbacks.onFrame(this.screen.apply(chunk));
    }
  }

  get columns(): number {
    return this._columns;
  }

  get rows(): number {
    return this._rows;
  }

  get kittyProtocolActive(): boolean {
    return this._kittyProtocolActive;
  }

  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(title: string): void {
    this.callbacks.onTitleChange(title);
  }
  setProgress(): void {}

  /** renderer 按键注入入口 */
  injectInput(data: string): void {
    this.inputHandler?.(data);
  }
}
