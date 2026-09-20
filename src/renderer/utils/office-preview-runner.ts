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

  /**
   * 本次调用是否已经有结果了。两个作用：
   * 1. **幂等**：`finishSuccess`/`finishFailure` 在 try 体与 catch 里都可能被调到，
   *    置位后重入直接返回，避免重复回调 / 重复收尾。
   * 2. 定时器回调入口的"已经晚了"检查（正常路径下 `finally` 里已经 `clearTimeout`，
   *    这是极小窗口的兜底）。
   *
   * 注意：定时器回调体是**同步**的（不 await 任何东西），所以"回调跑到一半渲染完成了"
   * 这种交错在结构上不存在——早先那版曾 await `getStatus`，才有了那个竞态。
   */
  let settled = false;

  const finishSuccess = (outPath: string) => {
    if (settled) return;
    settled = true;
    callbacks.onSuccess(outPath);
  };

  const finishFailure = () => {
    if (settled) return;
    settled = true;
    // 收尾交给主进程：只有它知道"上一条真实页面"是什么（跨调用存活），
    // 也只有它能判断此刻屏幕上是不是我们自己写的等待页——所以连"本次是否显示过
    // 等待页"都不用在渲染层记（连点场景里，正在显示的可能是**上一次**点击的等待页）。
    if (useAppStore.getState().rightPanelMode === "browser") {
      void (async () => {
        try {
          const api = window.electronAPI?.browser?.restorePreviousPage;
          const action = api ? await api() : "no-previous";
          if (action === "no-previous") {
            void window.electronAPI?.browser?.showStatusPage?.(
              callbacks.t("filePreview.officeRenderFailedRevealed"),
              "error",
            );
          }
        } catch {
          // 收尾失败就什么都不做：notice 与回退仍会发生
        }
      })();
    }
    callbacks.onFailure();
  };

  const busyTimer = setTimeout(() => {
    // 回调体是**同步**的：从下面这次检查到真正写页之间没有 await，所以不存在
    // "检查通过了、写之前渲染完成了"的交错（早先那版 await 过 getStatus，才有那个竞态）。
    // 因此这里只需检查一次——写两遍是死代码。
    void (async () => {
      if (settled || activeToken !== token) return;

      // 原有的行内 busy（文件树 / 产物面板）
      useAppStore.getState().setOfficePreviewBusyPath(filePath);

      // 只有一条等待路径：一律在面板里显示等待页（原 P2 的 toast 分支已删除）。
      // "用户原本在看哪一页"由主进程记录，不在这里存（它必须跨调用存活）。
      openBrowserPanel();
      void window.electronAPI?.browser?.showStatusPage?.(
        callbacks.t("filePreview.officePreviewLoading"),
        "loading",
      );
    })().catch(() => {
      // 定时器回调里的异常不能变成 unhandled rejection
    });
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
