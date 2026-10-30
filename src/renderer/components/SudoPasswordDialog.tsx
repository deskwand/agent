import type { SudoPasswordRequest } from "../types";
import { OccludingAlertDialog } from "./ui/occluding-dialog";
import {
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { SudoPasswordCard } from "./split/SudoPasswordCard";

interface SudoPasswordDialogProps {
  request: SudoPasswordRequest;
  sessionTitle?: string;
  onJump?: () => void;
}

/**
 * sudo 密码弹窗。
 *
 * 外壳由 shadcn 的 AlertDialog 承担，occlusion 由 OccludingAlertDialog 承担
 * （迁移前是本组件手写的 `useBrowserOcclusion(true)`）。
 *
 * 为什么用 AlertDialog 而不是 Dialog：它**不可关闭**（是「必须应答」的阻塞场景），
 * 用 Dialog 会多出一个关闭 X，且 Esc 会关掉弹窗而父级仍在等 sudo 应答。
 * AlertDialogContent 天生没有内置关闭键、也不响应遮罩点击。
 *
 * **按钮是普通 `<Button variant="ghost">`，不是 AlertDialogAction/Cancel** —— 从 Radix 源码核实：
 * `AlertDialogContent` 的 `onOpenAutoFocus` 会 `cancelRef.current?.focus()`，
 * 带上 `AlertDialogCancel` 就会把焦点抢到取消键上，而本弹窗要聚焦密码框
 * （见 PasswordInput）。`cancelRef` 为 null 时那行是 no-op，焦点留在原处。
 *
 * 输入框内的 Escape 仍走**取消**（`handleKeyDown`），这与外壳的 no-op 并存 ——
 * 这是原实现的行为，保留。
 */
export function SudoPasswordDialog({
  request,
  sessionTitle,
  onJump,
}: SudoPasswordDialogProps) {
  return (
    <OccludingAlertDialog
      open
      onOpenChange={() => {
        // 不可关闭：见组件文档。Esc 走到这里时什么都不做，
        // 弹窗保持可见，等用户用下面的按钮（或在输入框内按 Esc → 取消）应答。
      }}
    >
      <AlertDialogContent className="max-w-md p-6 gap-0">
        <SudoPasswordCard
          request={request}
          sessionTitle={sessionTitle}
          onJump={onJump}
          titleAs={AlertDialogTitle}
          descriptionAs={AlertDialogDescription}
        />
      </AlertDialogContent>
    </OccludingAlertDialog>
  );
}
