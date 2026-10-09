import type { ReactNode } from "react";
import { useBrowserOcclusion } from "../../hooks/useBrowserOcclusion";
import { AlertDialog } from "./alert-dialog";
import { Dialog } from "./dialog";
import { Sheet } from "./sheet";

/**
 * 弹窗的 occlusion 包装。
 *
 * `useBrowserOcclusion` 是 store 里的引用计数，在内置浏览器面板可见时
 * 把弹窗盖在它上面。原先 14 个弹窗各自手写这个 hook —— 漏一处不报错、
 * 不红测试，只在浏览器面板打开时静默被盖住（面板是原生视图，压在 DOM 之上）。
 *
 * 把 hook 收进这一层后，occlusion 由组件边界保证：新弹窗只要用
 * Occluding* 就天然正确。业务侧不再需要 import 那个 hook。
 *
 * 为什么三个包装都只包 Root 而不包 Content：shadcn 的 Dialog 是复合组件，
 * 调用方仍需要 DialogHeader / DialogFooter / DialogClose / DialogDescription
 * 等全部子件。只接管 Root 的 open 语义即可，其余 API 面原样透出。
 *
 * 引用计数天然处理「多个弹窗同时打开」：每个包装各占一个 id，
 * 最后一个释放时面板才恢复。因此原先 Sidebar.tsx:154 里那种
 * `Boolean(deleteConfirm) || createProjectModalOpen` 的合成布尔不再需要。
 */
interface OccludingProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function OccludingDialog({
  open,
  onOpenChange,
  children,
}: OccludingProps): JSX.Element {
  useBrowserOcclusion(open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {children}
    </Dialog>
  );
}

export function OccludingAlertDialog({
  open,
  onOpenChange,
  children,
}: OccludingProps): JSX.Element {
  useBrowserOcclusion(open);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {children}
    </AlertDialog>
  );
}

export function OccludingSheet({
  open,
  onOpenChange,
  children,
}: OccludingProps): JSX.Element {
  useBrowserOcclusion(open);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {children}
    </Sheet>
  );
}
