import { useAppStore } from "../store";
import { openBrowserPanel } from "./open-in-browser";

/**
 * busy 态延迟出现：常见热态只要 0.15s，立即显示会闪一下；而冷启的 ~1s
 * 能稳定看到它。见 design-docs/2026-09-20-office-html-preview-design.md §5.7。
 */
export const OFFICE_PREVIEW_BUSY_DELAY_MS = 150;

export interface OfficePreviewCallbacks {
  /** 渲染产物在磁盘上的**路径**（不是 file:// URL）。 */
  onSuccess: (outPath: string) => void;
  onFailure: () => void;
  /**
   * i18n 取词函数（组件把自己的 `t` 传进来）。
   *
   * 由调用方注入而不是本模块 import i18n：`i18n/config` 会
   * `i18n.use(initReactI18next)`，而不少组件测试只 mock 了 `react-i18next` 的
   * `useTranslation`——顶层 import 会让那些文件在模块加载阶段就炸（实测 6 个文件
   * 直接变成 "0 test"）。传函数进来既避开这个耦合，也让本模块保持同步、可单测。
   */
  t: (key: string) => string;
}

/**
 * 渲染一个 office 文档并把结果交给调用方。
 *
 * 并发语义：每次调用持有一个 token，**只有仍是"最新一次"时才允许回调**。没有这个
 * 守卫时，快速点了 A 再点 B，A 先回来就先把 A 画上屏幕、随后才被 B 覆盖——用户看到
 * 的是"我点了 xlsx，怎么先闪了一下 docx"。
 *
 * token 放在模块里而不是 store 里：store 的 create 只拿到 set（没有 get），在 action
 * 内引用 useAppStore 会让它"在自己的初始化器里引用自己"，TypeScript 推断成 any 并
 * 连带炸掉 ~300 处类型。而且这个"最新的那一个是谁"本来就是本次调用链的内部细节，
 * 不属于应用状态。测试之间无需重置：每次调用都会覆盖它。
 *
 * 契约：`onSuccess` / `onFailure` 不得抛错（实现只做导航与 notice，满足该前提）。
 */
let activeToken: object | null = null;
export async function openOfficePreview(
  filePath: string,
  callbacks: OfficePreviewCallbacks,
): Promise<void> {
  const token = {};
  activeToken = token;
  // 立刻清掉上一个 busy：否则连点时会短暂显示前一个文件的 spinner。
  useAppStore.getState().setOfficePreviewBusyPath(null);

  let waitingShown = false;
  let waitingToastId: string | null = null;

  const clearWaitingToast = () => {
    const store = useAppStore.getState();
    // 按 id 比对：盲目 clearGlobalNotice 会清掉别的功能刚设置的提示
    if (waitingToastId && store.globalNotice?.id === waitingToastId) {
      store.clearGlobalNotice();
    }
    waitingToastId = null;
  };

  /**
   * 本次调用是否已经有结果了。
   *
   * 光看 `activeToken !== token` 不够：`activeToken` 只在调用开始时被赋值、从不被清空，
   * 所以"渲染在等待 getStatus 的那几毫秒里完成了"这种情况它察觉不到——那时定时器回调
   * 会继续往下写等待页，把刚 navigate 出来的真预览**覆盖成一个永远转下去的 spinner**。
   */
  let settled = false;

  const finishSuccess = (outPath: string) => {
    settled = true;
    clearWaitingToast();
    callbacks.onSuccess(outPath);
  };

  const finishFailure = () => {
    settled = true;
    // 只在面板**仍处于浏览器模式**时才写错误页：关闭面板只 hide()，视图与页面还留着，
    // 写了它就会变成用户下次打开面板时的第一眼内容。
    if (waitingShown && useAppStore.getState().rightPanelMode === "browser") {
      void window.electronAPI?.browser?.showStatusPage?.(
        callbacks.t("filePreview.officeRenderFailedRevealed"),
        "error",
      );
    } else {
      clearWaitingToast();
    }
    callbacks.onFailure();
  };

  const busyTimer = setTimeout(() => {
    void (async () => {
      if (activeToken !== token) return;
      // 原有的行内 busy（文件树 / 产物面板）
      useAppStore.getState().setOfficePreviewBusyPath(filePath);

      const store = useAppStore.getState();
      const panelOpen = store.rightPanelMode === "browser";
      let statusUrl: string | undefined;
      try {
        statusUrl = (await window.electronAPI?.browser?.getStatus?.())?.url;
      } catch {
        statusUrl = undefined; // 取不到 → 面板开着时按"占用"处理
      }

      // await 之后必须重新校验两件事：
      // - 已被更新的点击取代（activeToken 变了）
      // - 本次已经出结果了（settled）——否则会把真预览覆盖成永久 spinner
      if (settled || activeToken !== token) return;

      const idle = !panelOpen || statusUrl === "about:blank";
      if (idle) {
        // 顺序有讲究：先切面板状态（App.tsx 的 effect 会据此调 browser.show()），
        // 再把等待页放进那个已存在的 webContents。两者竞态，但 showStatusPage
        // 不依赖可见性，所以哪个先到都行。
        openBrowserPanel();
        void window.electronAPI?.browser?.showStatusPage?.(
          callbacks.t("filePreview.officePreviewLoading"),
          "loading",
        );
        waitingShown = true;
      } else {
        waitingToastId = `office-preview-waiting-${Date.now()}`;
        store.setGlobalNotice({
          id: waitingToastId,
          type: "info",
          // message 是**必填**字段（`GlobalNotice.message: string`），messageKey 只是
          // 让 Toast 能随语言切换重译。仓库既有写法两者都给（见 useIPC.ts:592）。
          message: callbacks.t("filePreview.officePreviewLoading"),
          messageKey: "filePreview.officePreviewLoading",
        });
      }
    })();
  }, OFFICE_PREVIEW_BUSY_DELAY_MS);

  try {
    const api = window.electronAPI?.file?.renderOfficePreview;
    if (!api) {
      finishFailure();
      return;
    }

    const result = await api(filePath);

    // 已被更新的请求取代：丢弃，不回调也不动 busy。
    if (activeToken !== token) return;

    if (result?.ok && result.outPath) {
      finishSuccess(result.outPath);
    } else {
      finishFailure();
    }
  } catch {
    if (activeToken === token) finishFailure();
  } finally {
    clearTimeout(busyTimer);
    if (activeToken === token) {
      useAppStore.getState().setOfficePreviewBusyPath(null);
    }
  }
}
