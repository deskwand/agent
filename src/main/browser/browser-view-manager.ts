import type { BrowserWindow, WebContents } from "electron";
import { WebContentsView } from "electron";

/** CDP remote debugging port shared with agent-runner. */
export const BROWSER_CDP_PORT = "9224";

export interface BrowserStatus {
  visible: boolean;
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}
/**
 * Manages the in-app embedded browser panel via Electron WebContentsView.
 * Layout / bounds are driven by the React BrowserPanel via setBounds().
 */
export class BrowserViewManager {
  private view: WebContentsView | null = null;
  private parentWindow: BrowserWindow | null = null;
  private visible = false;
  private viewDestroyed = false;
  private onStatusChange: ((status: BrowserStatus) => void) | null = null;
  private _blankPageTheme: "dark" | "light" = "light";
  private _blankPageBgColor = "#ffffff";
  private _isOnBlankPage = false;

  // ---- lifecycle ----

  create(parentWindow: BrowserWindow): void {
    this.parentWindow = parentWindow;
    this.viewDestroyed = false;
    this.view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    const wc = this.view.webContents;

    // Track navigation events to push status updates
    wc.on("did-start-loading", () => this._pushStatus());
    wc.on("did-stop-loading", () => this._pushStatus());
    wc.on("did-navigate", (_event, url) => {
      // Detect navigation away from the blank page
      if (url !== this._blankPageUrl()) {
        this._isOnBlankPage = false;
      }
      this._pushStatus();
    });
    wc.on("did-navigate-in-page", () => this._pushStatus());
    wc.on("page-title-updated", () => this._pushStatus());
    wc.on("destroyed", () => {
      this.viewDestroyed = true;
    });

    wc.loadURL(this._blankPageUrl());
    this._isOnBlankPage = true;
    this.view.setVisible(false);
  }

  destroy(): void {
    if (this.visible) this._removeFromWindow();
    this.view?.webContents.close();
    this.view = null;
    this.parentWindow = null;
    this.visible = false;
    this.viewDestroyed = true;
  }

  /** Returns true if the underlying WebContentsView is alive and usable. */
  isViewAlive(): boolean {
    return this.view !== null && !this.viewDestroyed;
  }

  setStatusChangeHandler(handler: (status: BrowserStatus) => void): void {
    this.onStatusChange = handler;
  }

  // ---- visibility (layout controlled by React via setBounds) ----

  show(): void {
    if (!this.isViewAlive() || !this.parentWindow || this.visible) return;
    this.parentWindow.contentView.addChildView(this.view!);
    // CRITICAL: keep invisible until React BrowserPanel calls setBounds().
    this.view!.setVisible(false);
    this.visible = true;
    this._pushStatus();
  }

  hide(): void {
    if (!this.view || !this.parentWindow || !this.visible) return;
    this.view.setVisible(false);
    this._removeFromWindow();
    this.visible = false;
    this._pushStatus();
  }

  isVisible(): boolean {
    return this.visible;
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  /** Expose the underlying WebContents for puppeteer/CDP integration. */
  getWebContents(): WebContents | null {
    return this.view?.webContents ?? null;
  }

  /** App window URL (renderer), used to filter it out from CDP targets. */
  getAppWindowUrl(): string {
    return this.parentWindow?.webContents.getURL() ?? "";
  }

  /** Update the blank-page theme. Reloads the page if currently on blank. */
  setTheme(theme: "dark" | "light", blankPageBg?: string): void {
    if (blankPageBg !== undefined) {
      this._blankPageBgColor = blankPageBg;
    }
    // Skip reload only when: same theme AND view exists AND user is actively browsing.
    // Otherwise proceed — blank page may need re-render with updated bg colour.
    if (this._blankPageTheme === theme && this.view && !this._isOnBlankPage)
      return;
    this._blankPageTheme = theme;
    if (this.view && this._isOnBlankPage) {
      this.view.webContents.loadURL(this._blankPageUrl());
    }
  }

  // ---- navigation ----

  navigate(url: string): void {
    if (!this.isViewAlive()) return;
    if (!this.visible) this.show();
    if (url === "about:blank") {
      this._isOnBlankPage = true;
      this.view!.webContents.loadURL(this._blankPageUrl());
    } else {
      this._isOnBlankPage = false;
      this.view!.webContents.loadURL(url);
    }
  }

  reload(): void {
    this.view?.webContents.reload();
  }

  goBack(): void {
    if (this.view?.webContents.canGoBack()) {
      this.view.webContents.goBack();
    }
  }

  goForward(): void {
    if (this.view?.webContents.canGoForward()) {
      this.view.webContents.goForward();
    }
  }

  stop(): void {
    this.view?.webContents.stop();
  }

  // ---- status ----

  getStatus(): BrowserStatus {
    const wc = this.view?.webContents;
    const rawUrl = wc?.getURL() ?? "about:blank";
    // Normalise the internal data: blank page back to about:blank
    const url = this._isOnBlankPage ? "about:blank" : rawUrl;
    return {
      visible: this.visible,
      url,
      title: wc?.getTitle() ?? "",
      isLoading: wc?.isLoading() ?? false,
      canGoBack: wc?.canGoBack() ?? false,
      canGoForward: wc?.canGoForward() ?? false,
    };
  }

  // ---- bounds (driven by React BrowserPanel) ----

  setBounds(x: number, y: number, width: number, height: number): void {
    if (!this.view || !this.visible) return;
    this.view.setBounds({ x, y, width, height });
    this.view.setVisible(true);
  }

  // ---- internal ----

  private _removeFromWindow(): void {
    if (!this.view || !this.parentWindow) return;
    this.parentWindow.contentView.removeChildView(this.view);
  }

  private _pushStatus(): void {
    if (this.onStatusChange) {
      this.onStatusChange(this.getStatus());
    }
  }

  /** Data URL for a minimal blank page that respects the current theme. */
  private _blankPageUrl(): string {
    const rawBg =
      this._blankPageBgColor ||
      (this._blankPageTheme === "dark" ? "#18181b" : "#ffffff");
    // Sanitise: only allow hex/rgb colours to prevent CSS injection.
    const bg = /^#[0-9a-fA-F]{3,8}$|^rgb/.test(rawBg)
      ? rawBg
      : this._blankPageTheme === "dark"
        ? "#18181b"
        : "#ffffff";
    const html =
      "<!DOCTYPE html>" +
      '<html><head><meta charset="utf-8"><meta name="color-scheme" content="' +
      this._blankPageTheme +
      '"><style>html,body{margin:0;padding:0;height:100%;background:' +
      bg +
      ";}</style></head><body></body></html>";
    return `data:text/html;base64,${Buffer.from(html).toString("base64")}`;
  }
}
