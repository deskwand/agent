import type { BrowserWindow, WebContents } from "electron";
import { session, shell, WebContentsView } from "electron";
import { fileURLToPath } from "node:url";
import { log, logError } from "../utils/logger";

/** CDP remote debugging port shared with agent-runner. */
export const BROWSER_CDP_PORT = "9224";

export interface BrowserStatus {
  visible: boolean;
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** 主框架加载失败时的 Chromium 错误描述；新一次加载开始时清空。 */
  loadError?: string;
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
  private _loadError: string | undefined;

  // ---- lifecycle ----

  create(parentWindow: BrowserWindow): void {
    this.parentWindow = parentWindow;
    this.viewDestroyed = false;
    this.view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // Chromium 的内置 PDF 查看器以插件形式提供：不开这个开关，
        // 导航到 .pdf 不会渲染。其余安全开关保持不变。
        plugins: true,
      },
    });

    const wc = this.view.webContents;

    // Track navigation events to push status updates
    wc.on("did-start-loading", () => {
      this._loadError = undefined;
      this._pushStatus();
    });
    wc.on("did-stop-loading", () => this._pushStatus());
    wc.on("did-finish-load", () => {
      // 加载成功也要清：否则关掉再打开面板会看到上一次的陈旧报错。
      this._loadError = undefined;
      this._pushStatus();
    });
    wc.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, _url, isMainFrame) => {
        if (!isMainFrame) return;
        // ERR_ABORTED(-3)：被下载兜底或主动 stop 打断，属正常流程，不提示。
        if (errorCode === -3) return;
        this._loadError = errorDescription || `(${errorCode})`;
        this._pushStatus();
      },
    );
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
      void this.view!.webContents.loadURL(url).catch((error: unknown) => {
        logError("[Browser] loadURL failed:", url, error);
      });
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
      loadError: this._loadError,
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

/**
 * file:// 下载兜底。
 *
 * 白名单是按扩展名判断，而 Chromium 是按扩展名猜 MIME 决定「渲染还是下载」；
 * 两者不一致时导航会变成下载，弹出莫名其妙的「保存到…」对话框。
 * 这里把这类 file:// 下载取消掉，改用系统默认程序打开。
 * http(s) 下载一律放行 —— agent 的浏览器自动化仍需要正常下载。
 *
 * 必须挂在 app 级只调一次：session 是默认 session（与主窗口、OAuth 窗口共用），
 * 且 BrowserViewManager.destroy() 不摘监听，挂在 view 上会在窗口重建时叠加。
 */
export function installFileDownloadFallback(): void {
  session.defaultSession.on("will-download", (_event, item) => {
    const url = item.getURL();
    if (!url.startsWith("file://")) return;

    let filePath: string;
    try {
      filePath = fileURLToPath(url);
    } catch (error) {
      logError("[Browser] could not resolve download path:", url, error);
      return;
    }

    item.cancel();
    void shell.openPath(filePath).then((openError) => {
      if (openError) {
        logError("[Browser] fallback open failed:", filePath, openError);
        return;
      }
      log(
        "[Browser] opened unsupported file with the system handler:",
        filePath,
      );
    });
  });
}
