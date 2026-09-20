import { useAppStore } from "../store";

/**
 * busy 态延迟出现：常见热态只要 0.15s，立即显示会闪一下；而冷启的 ~1s
 * 能稳定看到它。见 design-docs/2026-09-20-office-html-preview-design.md §5.7。
 */
export const OFFICE_PREVIEW_BUSY_DELAY_MS = 150;

export interface OfficePreviewCallbacks {
  /** 渲染产物在磁盘上的**路径**（不是 file:// URL）。 */
  onSuccess: (outPath: string) => void;
  onFailure: () => void;
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

  const busyTimer = setTimeout(() => {
    if (activeToken === token) {
      useAppStore.getState().setOfficePreviewBusyPath(filePath);
    }
  }, OFFICE_PREVIEW_BUSY_DELAY_MS);

  try {
    const api = window.electronAPI?.file?.renderOfficePreview;
    if (!api) {
      callbacks.onFailure();
      return;
    }

    const result = await api(filePath);

    // 已被更新的请求取代：丢弃，不回调也不动 busy。
    if (activeToken !== token) return;

    if (result?.ok && result.outPath) {
      callbacks.onSuccess(result.outPath);
    } else {
      callbacks.onFailure();
    }
  } catch {
    if (activeToken === token) callbacks.onFailure();
  } finally {
    clearTimeout(busyTimer);
    if (activeToken === token) {
      useAppStore.getState().setOfficePreviewBusyPath(null);
    }
  }
}
