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
  private _statusPageDataUrl: string | null = null;
  /** 最近一次确认"用户真的在看"的页面（既不是空白页也不是我们的状态页）。 */
  private _lastRealPageUrl: string | null = null;
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
      // 记住"用户真的在看"的那一页：空白页与我们的状态页都不算。
      // 跨调用保留——恢复要用的正是"上一条真实页面"，而它在被状态页顶掉之后就问不到了。
      if (url !== this._blankPageUrl() && url !== this._statusPageDataUrl) {
        this._lastRealPageUrl = url;
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
    this._statusPageDataUrl = null;
    this._lastRealPageUrl = null;
    this.view.setVisible(false);
  }

  destroy(): void {
    if (this.visible) this._removeFromWindow();
    this.view?.webContents.close();
    this.view = null;
    this._statusPageDataUrl = null;
    this._lastRealPageUrl = null;
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

  /**
   * 在浏览器视图里显示一个状态页（"正在生成预览…" / 错误页）。
   *
   * **故意不碰可见性**：面板显示与否由渲染层单向驱动
   * （`App.tsx` 的 useLayoutEffect 按 rightPanelMode 调 `browser.show()/hide()`），
   * 而本方法与那次 show() 是竞态的。因此这里只把页面加载进**已存在的** webContents：
   * 若以 `visible` 为前提，冷启（面板从未打开过）时就会静默什么都不显示。
   * 同文件 navigate() 里的 `if (!this.visible) this.show();` **不要照抄到这里**。
   */
  showStatusPage(text: string, kind: "loading" | "error" = "loading"): void {
    if (!this.isViewAlive()) return;
    const dataUrl = this._buildStatusPageUrl(text, kind);
    this._statusPageDataUrl = dataUrl;
    void this.view!.webContents.loadURL(dataUrl).catch((error: unknown) => {
      logError("[Browser] status page load failed:", error);
    });
  }

  /** 自包含状态页；配色沿用空白页那一套。 */
  private _buildStatusPageUrl(text: string, kind: "loading" | "error"): string {
    const rawBg =
      this._blankPageBgColor ||
      (this._blankPageTheme === "dark" ? "#18181b" : "#ffffff");
    // 与 _blankPageUrl 同一条约束（有意保持逐字一致）：只允许 hex/rgb。
    // 注意 `^rgb` 这个分支没有锚定结尾，理论上 `rgb(1,1,1);background-image:url(…)`
    // 能过——但值来自 browser.setTheme（渲染层自己的值），且既有 _blankPageUrl 是
    // 同一个弱点。要收紧应当两处一起改，属独立改动。
    const bg = /^#[0-9a-fA-F]{3,8}$|^rgb/.test(rawBg) ? rawBg : "#ffffff";
    const fg = this._blankPageTheme === "dark" ? "#e4e4e7" : "#3f3f46";
    // text 来自我们自己的 i18n 文案，仍做最小转义，免得把 HTML 拼坏。
    const safeText = text.replace(
      /[&<>]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string,
    );
    const spinner =
      kind === "loading"
        ? '<div style="width:22px;height:22px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin .8s linear infinite;opacity:.5"></div>'
        : "";
    const html =
      "<!DOCTYPE html>" +
      '<html><head><meta charset="utf-8"><meta name="color-scheme" content="' +
      this._blankPageTheme +
      '"><style>' +
      "html,body{margin:0;height:100%;background:" +
      bg +
      ";color:" +
      fg +
      ';font:13px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
      ".wrap{height:100%;display:flex;flex-direction:column;align-items:center;" +
      "justify-content:center;gap:12px;padding:0 24px;text-align:center}" +
      "@keyframes spin{to{transform:rotate(360deg)}}" +
      "@media (prefers-reduced-motion: reduce){.wrap div{animation:none!important}}" +
      '</style></head><body><div class="wrap">' +
      spinner +
      "<div>" +
      safeText +
      "</div></div></body></html>";
    return `data:text/html;base64,${Buffer.from(html).toString("base64")}`;
  }

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
    // 关面板时若还停在我们自己写的状态页上，就换回空白页：视图与已加载的页面是留着的，
    // 不换的话下次打开面板会看到一屏永远转下去的 spinner（没有任何事件能结束它）。
    // 面板关掉之后"用户原本在看哪一页"就不再是上下文了，别让下次失败把它拉回来。
    this._lastRealPageUrl = null;
    if (
      this._statusPageDataUrl &&
      this.view.webContents.getURL() === this._statusPageDataUrl
    ) {
      this._statusPageDataUrl = null;
      this._isOnBlankPage = true;
      void this.view.webContents
        .loadURL(this._blankPageUrl())
        .catch((error: unknown) => {
          logError("[Browser] blank page load failed:", error);
        });
    }
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

  /**
   * 预览失败后的收尾。三态返回值让调用方能区分"已经还原了"、"当前就是真实页面、
   * 什么都不该动"和"没有可还原的页面（应显示错误页）"。
   *
   * 只做导航，**不碰可见性**（与 showStatusPage 同一条约束）；面板不可见时直接判定
   * 为没有可还原的页面，避免把已经隐藏的视图重新挂回来。
   */
  restorePreviousPage(): BrowserRecoveryAction {
    const wc = this.view?.webContents;
    if (!wc || !this.visible) return "no-previous";

    const action = browserRecoveryAction(
      wc.getURL(),
      this._statusPageDataUrl,
      this._lastRealPageUrl,
    );
    if (action === "restored" && this._lastRealPageUrl) {
      const target = this._lastRealPageUrl;
      this._statusPageDataUrl = null;
      void wc.loadURL(target).catch((error: unknown) => {
        logError("[Browser] restore previous page failed:", error);
      });
    }
    return action;
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
      this._statusPageDataUrl = null;
      this.view!.webContents.loadURL(this._blankPageUrl());
    } else {
      this._isOnBlankPage = false;
      this._statusPageDataUrl = null;
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
    const url = displayUrlFor(
      rawUrl,
      this._isOnBlankPage,
      this._statusPageDataUrl,
    );
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

/**
 * 状态页与空白页都不该把内部 URL 暴露给渲染层：前者是主进程构造的
 * `data:text/html;base64,…`（地址栏会显示一大串 base64，还会点亮"用外部浏览器打开"），
 * 后者是既有的空白页。两者统一归一化成 `about:blank`。
 */
export function displayUrlFor(
  rawUrl: string,
  isOnBlankPage: boolean,
  statusPageUrl: string | null,
): string {
  if (isOnBlankPage) return "about:blank";
  if (statusPageUrl && rawUrl === statusPageUrl) return "about:blank";
  return rawUrl;
}

export type BrowserRecoveryAction =
  | "restored"
  | "nothing-to-restore"
  | "no-previous";

/**
 * 预览失败后面板该怎么收尾（纯函数，便于单测）。
 *
 * - 当前页正是我们的状态页 且 记得上一页 → `restored`（把它还原回去）
 * - 当前页是真实页面（例如渲染很快、我们压根没动过页面）→ `nothing-to-restore`
 *   （什么都不该动，尤其不能往上写错误页）
 * - 其余（空白页/状态页但没有上一页）→ `no-previous`，由调用方显示错误页
 */
export function browserRecoveryAction(
  currentUrl: string,
  statusPageUrl: string | null,
  lastRealPageUrl: string | null,
): BrowserRecoveryAction {
  const onStatusPage = !!statusPageUrl && currentUrl === statusPageUrl;
  if (onStatusPage) {
    return lastRealPageUrl ? "restored" : "no-previous";
  }
  return "nothing-to-restore";
}
