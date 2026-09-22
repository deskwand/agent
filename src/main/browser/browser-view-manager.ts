import type { BrowserWindow, WebContents } from "electron";
import { session, shell, WebContentsView } from "electron";
import { fileURLToPath } from "node:url";
import { log, logError, logWarn } from "../utils/logger";
import type {
  ElementSelection,
  PickerStartResult,
} from "../../shared/ipc-types";
import {
  buildElementSelection,
  nextPickerActive,
  type InspectorInput,
  type PageProbe,
  type PickerEvent,
} from "./element-inspector";

/** 定位高亮存活时长：够看清、又不至于变成取消不掉的浮层。 */
export const PICKER_HIGHLIGHT_MS = 4000;

/**
 * 单条 CDP 命令的超时。一条永不返回的命令**不能**把整条串行队列堵死——
 * 否则 disarm / hideHighlight 永远轮不到，页面就卡在检查模式里且不可恢复。
 */
export const PICKER_COMMAND_TIMEOUT_MS = 5000;

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
      // 导航使拾取会话的初始化失效：下一次初始化要重新收集 stylesheet headers。
      this.pickerReady = false;
      this.pickerStylesheetHeaders.clear();
      void this._exitPicker("view-gone");
    });
    wc.on("did-navigate-in-page", () => {
      this._pushStatus();
      void this._exitPicker("view-gone");
    });
    // 主框架导航一开始就取消：等到 did-navigate 才取消，中间的捕获窗口是陈旧的。
    wc.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
      if (!isMainFrame || isInPlace) return;
      this.pickerReady = false;
      this.pickerStylesheetHeaders.clear();
      void this._exitPicker("view-gone");
    });
    wc.on("page-title-updated", () => this._pushStatus());
    wc.on("destroyed", () => {
      void this._exitPicker("view-gone");
      this._releasePickerSession();
      this.viewDestroyed = true;
    });

    wc.loadURL(this._blankPageUrl());
    this._isOnBlankPage = true;
    this._statusPageDataUrl = null;
    this._lastRealPageUrl = null;
    this.view.setVisible(false);
  }

  destroy(): void {
    this._cancelHighlightTimer();
    if (this.visible) this._removeFromWindow();
    void this._exitPicker("view-gone");
    this._releasePickerSession();
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
    // 提前 return 之前就要退出拾取：面板关掉后页面仍在，但用户已经看不到它了。
    void this._exitPicker("view-gone");
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

  // ---- element picker (Design Mode v1) ----
  //
  // CDP 会话归**视图**，不归检查开关：stop / Esc / 导航只关掉检查模式与高亮，
  // debugger 与监听一直挂到视图销毁——否则退出拾取后磁贴就没法再 highlight 了。

  private pickerDebugger: Electron.Debugger | null = null;
  private pickerReady = false;
  private pickerActive = false;
  private pickerRequested = false;
  private pickerGeneration = 0;
  private pickerWork: Promise<unknown> = Promise.resolve();
  private pickerStartPromise: Promise<PickerStartResult> | null = null;
  private pickerStylesheetHeaders = new Map<string, string>();
  /** 磁贴/chip 定位高亮的自动清除定时器（见 highlight 的注释） */
  private pickerHighlightTimer: NodeJS.Timeout | null = null;
  private pickerHandlers: {
    onStateChange: (active: boolean) => void;
    onSelected: (selection: ElementSelection) => void;
  } | null = null;

  setPickerHandlers(
    handlers: NonNullable<BrowserViewManager["pickerHandlers"]>,
  ): void {
    this.pickerHandlers = handlers;
  }

  isPickerActive(): boolean {
    return this.pickerActive;
  }

  /**
   * `requireVisible` 只对**开始拾取**为真：没有可见页面就没有可点的东西。
   * 但磁贴的 `highlight()` 必须能在面板关着时工作 —— 那是"点磁贴回页面定位"
   * 这条主路径的常见状态（磁贴在输入框旁，浏览器面板随时可能被关掉）。
   */
  private _pickerAvailable(requireVisible = true): boolean {
    return (
      this.isViewAlive() &&
      (!requireVisible || this.visible) &&
      !this._isOnBlankPage &&
      !this._statusPageDataUrl &&
      !this._loadError
    );
  }

  private _pickerCurrent(generation: number, dbg?: Electron.Debugger): boolean {
    return (
      generation === this.pickerGeneration &&
      this.isViewAlive() &&
      (!dbg || (dbg === this.pickerDebugger && dbg.isAttached()))
    );
  }

  /** 带超时的 CDP 命令：超时与失败都只影响这一次调用，不拖累后续命令。 */
  private async _sendWithTimeout(
    dbg: Electron.Debugger,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        dbg.sendCommand(method, params),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`CDP ${method} timed out`)),
            PICKER_COMMAND_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** 调用串行化：CDP 上的命令是有顺序的，并发只换来难查的竞态。 */
  private _queuePicker<T>(work: () => Promise<T>): Promise<T> {
    const next = this.pickerWork.then(work);
    this.pickerWork = next.catch(() => {});
    return next;
  }

  private async _pickerCommand(
    dbg: Electron.Debugger,
    generation: number,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this._pickerCurrent(generation, dbg)) throw PICKER_CANCELED;
    const result: unknown = await this._sendWithTimeout(dbg, method, params);
    if (!this._pickerCurrent(generation, dbg)) throw PICKER_CANCELED;
    return result;
  }

  /** 建立会话 —— 只建立本模块自己的，不接管别人已 attach 的 debugger。 */
  private async _ensurePickerSession(
    generation: number,
    requireVisible = true,
  ): Promise<Electron.Debugger> {
    if (
      !this._pickerCurrent(generation) ||
      !this._pickerAvailable(requireVisible)
    ) {
      throw PICKER_CANCELED;
    }
    let dbg = this.pickerDebugger;
    if (!dbg) {
      dbg = this.view!.webContents.debugger;
      // 不接管其它本地模块或 DevTools 已持有的 debugger。
      if (dbg.isAttached()) throw new Error("Debugger owned by another client");
      dbg.attach("1.3");
      this.pickerDebugger = dbg;
      dbg.on("message", this._onPickerMessage);
      dbg.on("detach", this._onPickerDetach);
    }
    if (!this.pickerReady) {
      await this._pickerCommand(dbg, generation, "DOM.enable");
      // pushNodesByBackendIdsToFrontend 前必须请求 document。
      await this._pickerCommand(dbg, generation, "DOM.getDocument");
      await this._pickerCommand(dbg, generation, "CSS.disable");
      this.pickerStylesheetHeaders.clear();
      await this._pickerCommand(dbg, generation, "CSS.enable");
      await this._pickerCommand(dbg, generation, "Accessibility.enable");
      await this._pickerCommand(dbg, generation, "Overlay.enable");
      this.pickerReady = true;
    }
    return dbg;
  }

  startPicker(): Promise<PickerStartResult> {
    if (this.pickerRequested) {
      return this.pickerStartPromise ?? Promise.resolve({ ok: true });
    }
    if (!this._pickerAvailable()) {
      return Promise.resolve({ ok: false, reason: "not-available" });
    }
    this.pickerRequested = true;
    const generation = ++this.pickerGeneration;
    const pending = this._queuePicker(async (): Promise<PickerStartResult> => {
      try {
        await this._ensurePickerSession(generation);
        await this._armPicker(generation);
        this._setPickerActive(nextPickerActive(this.pickerActive, "start"));
        return { ok: true };
      } catch (error) {
        if (error === PICKER_CANCELED || !this._pickerCurrent(generation)) {
          return { ok: false, reason: "not-available" };
        }
        this.pickerRequested = false;
        this._setPickerActive(false);
        this._releasePickerSession();
        logError("[Browser] picker start failed:", error);
        return { ok: false, reason: "attach-failed" };
      }
    });
    this.pickerStartPromise = pending;
    void pending.then(() => {
      if (this.pickerStartPromise === pending) this.pickerStartPromise = null;
    });
    return pending;
  }

  stopPicker(): Promise<void> {
    return this._exitPicker("stop");
  }

  /**
   * 退出拾取。**只关检查模式与高亮**，不 disable Overlay、不 detach：
   * 会话由视图持有，后续磁贴的 highlight 仍要能用（不必重新走一遍 enable）。
   */
  private _exitPicker(event: PickerEvent): Promise<void> {
    // 只关「还会不会有下一次拾取」，**不递增代次**：递增会把已完成但尚未交付的捕获
    // 一起作废，而 spec §6 要求已拾取的仍要交付（「用户点了就该有结果」）。
    // 启动中的任务仍会被取消：_armPicker 检查 pickerRequested；
    // 而 startPicker 自己会递增代次，所以 stop 后再 start 不会把旧捕获送进新会话。
    this.pickerRequested = false;
    this.pickerStartPromise = null;
    this._cancelHighlightTimer();
    this._setPickerActive(nextPickerActive(this.pickerActive, event));
    const dbg = this.pickerDebugger;
    if (!dbg || dbg !== this.pickerDebugger || !dbg.isAttached()) {
      return Promise.resolve();
    }
    // **不走 _queuePicker**：退出必须能立刻生效，而串行队列可能正卡在一次
    // 未返回的捕获命令上（那样 disarm 永远轮不到，页面卡在检查模式且不可恢复）。
    // 这两条命令与捕获之间没有顺序依赖：捕获只是在读 DOM/CSS。
    // 命令集合照 DevTools 自己退出检查模式的做法（setInspectMode(none) + hideHighlight）；
    // 不再额外 disable Overlay——那是押在未验证机制上的兜底，而代价（每次退出后
    // 重点/点 chip 都要重跑 5 条 enable 初始化）落在常用路径上。
    return (async () => {
      // highlightConfig 显式给空对象：DevTools 就是这么调的，
      // 而"省略它"是否被接受是实现细节——不能把退出押在实现细节上。
      await this._sendWithTimeout(dbg, "Overlay.setInspectMode", {
        mode: "none",
        highlightConfig: {},
      }).catch((error: unknown) =>
        logWarn("[Browser] picker disarm failed:", error),
      );
      await this._sendWithTimeout(dbg, "Overlay.hideHighlight").catch(
        (error: unknown) =>
          logWarn("[Browser] picker hideHighlight failed:", error),
      );
    })();
  }

  highlight(selector: string): Promise<boolean> {
    const generation = this.pickerGeneration;
    return this._queuePicker(async () => {
      try {
        // 面板关着时磁贴仍要能用：先把视图挂回窗口（渲染层的 BrowserPanel
        // 挂载后会跟上设 bounds），否则高亮画在用户看不见的视图上，等于点了没反应。
        if (!this.visible && this.isViewAlive()) this.show();
        const dbg = await this._ensurePickerSession(generation, false);
        const { root } = (await this._pickerCommand(
          dbg,
          generation,
          "DOM.getDocument",
        )) as { root: { nodeId: number } };
        const { nodeIds } = (await this._pickerCommand(
          dbg,
          generation,
          "DOM.querySelectorAll",
          { nodeId: root.nodeId, selector },
        )) as { nodeIds: number[] };
        // 不唯一时不能把第一个冒充用户选中的那个。
        if (nodeIds.length !== 1) return false;
        await this._pickerCommand(
          dbg,
          generation,
          "DOM.scrollIntoViewIfNeeded",
          {
            nodeId: nodeIds[0],
          },
        );
        await this._pickerCommand(dbg, generation, "Overlay.highlightNode", {
          nodeId: nodeIds[0],
          highlightConfig: { showInfo: true },
        });
        // 这是**定位闪光**，不是持久标注：画完必须自己会消失。
        // 否则用户在拾取模式关闭时点 chip 定位，就再也取消不掉那层浮层
        // （Esc 不在检查模式里不会触发 canceled，点 🎯 反而先进入拾取模式）。
        this._scheduleHighlightClear(dbg, generation);
        return true;
      } catch (error) {
        if (error !== PICKER_CANCELED) {
          logWarn("[Browser] highlight failed:", error);
        }
        return false;
      }
    });
  }

  clearHighlight(): Promise<void> {
    this._cancelHighlightTimer();
    const generation = this.pickerGeneration;
    return this._queuePicker(async () => {
      const dbg = this.pickerDebugger;
      if (!dbg || !this._pickerCurrent(generation, dbg)) return;
      await this._pickerCommand(dbg, generation, "Overlay.hideHighlight").catch(
        () => {},
      );
    });
  }

  /** 重新排一次自动清除（连续点多个 chip 时以最后一次为准）。 */
  private _scheduleHighlightClear(
    dbg: Electron.Debugger,
    generation: number,
  ): void {
    this._cancelHighlightTimer();
    this.pickerHighlightTimer = setTimeout(() => {
      this.pickerHighlightTimer = null;
      if (!this._pickerCurrent(generation, dbg)) return;
      void this._queuePicker(async () => {
        if (!this._pickerCurrent(generation, dbg)) return;
        await this._pickerCommand(
          dbg,
          generation,
          "Overlay.hideHighlight",
        ).catch(() => {});
      });
    }, PICKER_HIGHLIGHT_MS);
  }

  private _cancelHighlightTimer(): void {
    if (this.pickerHighlightTimer) {
      clearTimeout(this.pickerHighlightTimer);
      this.pickerHighlightTimer = null;
    }
  }

  private _setPickerActive(active: boolean): void {
    if (this.pickerActive === active) return;
    this.pickerActive = active;
    this.pickerHandlers?.onStateChange(active);
  }

  private async _armPicker(generation: number): Promise<void> {
    const dbg = this.pickerDebugger;
    if (!dbg || !this.pickerRequested) throw PICKER_CANCELED;
    await this._pickerCommand(dbg, generation, "Overlay.setInspectMode", {
      mode: "searchForNode",
      highlightConfig: { showInfo: true },
    });
  }

  private _onPickerDetach = (): void => {
    ++this.pickerGeneration;
    this.pickerRequested = false;
    this.pickerStartPromise = null;
    this._setPickerActive(false);
    this._releasePickerSession();
  };

  private _onPickerMessage = (
    _event: Electron.Event,
    method: string,
    params: Record<string, unknown>,
  ): void => {
    if (method === "CSS.styleSheetAdded") {
      const header = params.header as
        | { styleSheetId?: string; sourceURL?: string }
        | undefined;
      if (header?.styleSheetId && header.sourceURL) {
        this.pickerStylesheetHeaders.set(header.styleSheetId, header.sourceURL);
      }
    } else if (method === "Overlay.inspectModeCanceled") {
      void this._exitPicker("canceled");
    } else if (
      method === "Overlay.inspectNodeRequested" &&
      this.pickerRequested
    ) {
      const id = params.backendNodeId;
      if (typeof id !== "number") return;
      const generation = this.pickerGeneration;
      void this._queuePicker(() => this._capturePickedNode(id, generation));
    }
  };

  /** 只释放本模块建立的会话（pickerDebugger 为 null 时是空操作）。 */
  private _releasePickerSession(): void {
    const dbg = this.pickerDebugger;
    if (dbg) {
      dbg.removeListener("message", this._onPickerMessage);
      dbg.removeListener("detach", this._onPickerDetach);
      try {
        if (dbg.isAttached()) dbg.detach();
      } catch (error) {
        logWarn("[Browser] picker detach failed:", error);
      }
    }
    this.pickerDebugger = null;
    this.pickerReady = false;
    this.pickerStylesheetHeaders.clear();
  }

  private async _capturePickedNode(
    backendNodeId: number,
    generation: number,
  ): Promise<void> {
    const dbg = this.pickerDebugger;
    // 交付只受**代次**约束，不受 pickerRequested 约束 —— 见下方交付点处的说明：
    // 每一次 Overlay.inspectModeCanceled 都会清掉 pickerRequested，若浏览器在
    // inspectNodeRequested 之后才自动 canceled，拿它当门禁会把每次拾取都默默丢掉。
    if (!dbg || !this._pickerCurrent(generation, dbg)) {
      return;
    }
    try {
      const { nodeIds } = (await this._pickerCommand(
        dbg,
        generation,
        "DOM.pushNodesByBackendIdsToFrontend",
        { backendNodeIds: [backendNodeId] },
      )) as { nodeIds: Array<number | null> };
      const nodeId = nodeIds?.[0];
      if (typeof nodeId !== "number") return;

      const { node } = (await this._pickerCommand(
        dbg,
        generation,
        "DOM.describeNode",
        { nodeId },
      )) as { node: { nodeName: string; attributes: string[] } };
      const { outerHTML } = (await this._pickerCommand(
        dbg,
        generation,
        "DOM.getOuterHTML",
        { nodeId },
      )) as { outerHTML: string };
      const boxModel = (await this._pickerCommand(
        dbg,
        generation,
        "DOM.getBoxModel",
        { nodeId },
      ).catch(() => null)) as { model: { border: number[] } } | null;
      const { computedStyle } = (await this._pickerCommand(
        dbg,
        generation,
        "CSS.getComputedStyleForNode",
        { nodeId },
      ).catch(() => ({ computedStyle: [] }))) as {
        computedStyle: Array<{ name: string; value: string }>;
      };
      const matchedStyles = await this._pickerCommand(
        dbg,
        generation,
        "CSS.getMatchedStylesForNode",
        { nodeId },
      ).catch(() => null);
      const axTree = (await this._pickerCommand(
        dbg,
        generation,
        "Accessibility.getPartialAXTree",
        { nodeId, fetchRelatives: false },
      ).catch(() => null)) as {
        nodes?: Array<{ role?: { value?: string }; name?: { value?: string } }>;
      } | null;

      // 页面内一次算完 selector / 唯一性 / domPath / 文本 / 视口几何。
      // 这是"读数据"的函数，不是一个覆盖层 —— 高亮仍然由 Chromium 画。
      // CDP 不能把元素直接交给 Runtime.evaluate：必须先 DOM.resolveNode 拿到
      // objectId，再在那个元素上 callFunctionOn。
      const { object } = (await this._pickerCommand(
        dbg,
        generation,
        "DOM.resolveNode",
        { nodeId },
      )) as { object: { objectId?: string } };
      const objectId = object.objectId;
      if (!objectId) return;
      const { result } = (await this._pickerCommand(
        dbg,
        generation,
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration: PAGE_PROBE_FUNCTION,
          returnByValue: true,
        },
      ).finally(() => {
        if (dbg.isAttached()) {
          void dbg
            .sendCommand("Runtime.releaseObject", { objectId })
            .catch(() => {});
        }
      })) as { result: { value?: unknown } };
      const probe = result?.value as
        | (PageProbe & {
            viewport: { width: number; height: number; dpr: number };
            scroll: { x: number; y: number };
            parent: InspectorInput["parent"];
            siblings: InspectorInput["siblings"];
          })
        | undefined;
      if (!probe) return;

      const selection = buildElementSelection({
        pageUrl: this.view!.webContents.getURL(),
        pageTitle: this.view!.webContents.getTitle(),
        probe,
        node,
        outerHtml: outerHTML,
        boxModel: boxModel ? { border: boxModel.model.border } : null,
        computedEntries: computedStyle ?? [],
        matchedStyles,
        stylesheetHeaders: this.pickerStylesheetHeaders,
        axNode: axTree?.nodes?.[0] ?? null,
        viewport: probe.viewport,
        scroll: probe.scroll,
        parent: probe.parent,
        siblings: probe.siblings,
      });
      // 交付只受**代次**约束，不受 pickerRequested 约束：
      // spec §6 明写「渲染层收到 selected 但拾取态已被关掉（竞态）→ 照常加磁贴
      // —— 用户点了就该有结果」。pickerRequested 会被每一次
      // Overlay.inspectModeCanceled 清掉（_onPickerMessage），若 Chromium 在
      // inspectNodeRequested **之后**才自动 canceled（spec §7 spike 2 点名过这个可能），
      // 拿它当交付门禁就会把每一次拾取都默默丢掉、同时把拨杆自动关掉——
      // 功能什么都不做且没有任何报错。代次已经足够：startPicker 递增代次，
      // 视图销毁 / 外部 detach 也会递增。
      if (!this._pickerCurrent(generation, dbg)) return;
      if (selection) this.pickerHandlers?.onSelected(selection);
    } catch (error) {
      if (this._pickerCurrent(generation, dbg)) {
        logError("[Browser] capture picked node failed:", error);
      }
    } finally {
      // 延时回调也必须验证原代次；stop 后 start 不得被旧捕获重新武装。
      if (this._pickerCurrent(generation, dbg) && this.pickerRequested) {
        setTimeout(() => {
          if (!this._pickerCurrent(generation, dbg) || !this.pickerRequested)
            return;
          void this._queuePicker(() => this._armPicker(generation)).catch(
            () => {},
          );
        }, 0);
      }
    }
  }
}

/** 取消哨兵：不是错误，只是让 in-flight 的 await 与定时器失效。 */
const PICKER_CANCELED = new Error("Picker operation canceled");

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

/**
 * 页面内探针：在选中元素自己身上跑一次，算出 selector / 唯一性 / domPath /
 * 文本 / 父与兄弟的几何。
 *
 * 刻意返回字符串而不是函数：`Runtime.callFunctionOn` 的 `functionDeclaration`
 * 需要的是源码，且不能带任何闭包依赖 —— 它在页面里求值，拿不到模块作用域。
 */
export const PAGE_PROBE_FUNCTION = `function () {
  const uniq = (sel) => {
    try { return document.querySelectorAll(sel).length === 1; } catch { return false; }
  };
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s);
  const partFor = (node) => {
    if (node.id) return '#' + esc(node.id);
    let part = node.tagName.toLowerCase();
    if (node.classList.length) {
      part += '.' + Array.from(node.classList).slice(0, 2).map(esc).join('.');
    }
    const parent = node.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
      if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')';
    }
    return part;
  };
  const segments = [];
  let cur = this;
  while (cur && cur.nodeType === 1 && segments.length < 12) {
    segments.unshift(partFor(cur));
    if (uniq(segments.join(' > '))) break;
    cur = cur.parentElement;
  }
  const selector = segments.join(' > ');
  const domSegments = [];
  cur = this;
  while (cur && cur.nodeType === 1) {
    if (cur.id) {
      domSegments.unshift(cur.tagName.toLowerCase() + '#' + cur.id);
      break;
    }
    const parent = cur.parentElement;
    if (!parent) { domSegments.unshift(cur.tagName.toLowerCase()); break; }
    const index = Array.from(parent.children).indexOf(cur) + 1;
    domSegments.unshift(cur.tagName.toLowerCase() + ':nth-child(' + index + ')');
    cur = parent;
  }
  const rectOf = (node) => {
    const r = node.getBoundingClientRect();
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  };
  const segOf = (node) => {
    const cls = Array.from(node.classList || []).slice(0, 2);
    return node.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : '');
  };
  // 父 / 兄弟的几何是多选的真正价值：用户说"这三个没对齐"，
  // 模型需要的是三个 y 坐标加一个 flex 容器，而不是一张截图。
  const parentEl = this.parentElement;
  const parent = parentEl
    ? {
        selector: segOf(parentEl),
        tag: parentEl.tagName.toLowerCase(),
        display: getComputedStyle(parentEl).display,
        gap: getComputedStyle(parentEl).gap,
        rect: rectOf(parentEl),
      }
    : null;
  const siblings = parentEl
    ? Array.from(parentEl.children)
        .filter((c) => c !== this)
        .slice(0, 6)
        .map((c) => ({
          tag: c.tagName.toLowerCase(),
          classes: Array.from(c.classList || []).slice(0, 2),
          rect: rectOf(c),
        }))
    : [];
  return {
    selector,
    selectorUnique: uniq(selector),
    domPath: domSegments.join(' > '),
    text: (this.innerText || '').trim(),
    computedShorthands: ['margin', 'padding', 'border', 'border-radius'].map((name) => ({
      name, value: getComputedStyle(this).getPropertyValue(name),
    })),
    parent,
    siblings,
    viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
    scroll: { x: window.scrollX, y: window.scrollY },
  };
}`;
