import type { PermissionRequest } from "../types";
import { OccludingAlertDialog } from "./ui/occluding-dialog";
import {
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { PermissionCard } from "./split/PermissionCard";

interface PermissionDialogProps {
  permission: PermissionRequest;
  sessionTitle?: string;
  onJump?: () => void;
}

/**
 * 权限请求弹窗。
 *
 * 外壳（遮罩、焦点、层级）由 shadcn 的 AlertDialog 承担，occlusion 由
 * OccludingAlertDialog 承担（迁移前是本组件手写的 `useBrowserOcclusion(true)`）。
 *
 * 为什么用 AlertDialog 而不是 Dialog —— 这个弹窗**不可关闭**：
 *   - 父级按「有待答权限」挂载它，没有 isOpen；原实现也完全不处理 Esc
 *   - 唯一的出口是下面三个按钮
 * 若用 Dialog：(a) 会多出一个关闭 X；(b) Esc 会经 onOpenChange(false) 把弹窗关掉，
 * 而父级仍认为有待答权限 → **弹窗消失、权限未应答、agent 卡住**。
 * AlertDialogContent 天生没有内置关闭键、也不响应遮罩点击，所以下面的
 * onOpenChange 只作为 no-op 即可完全复现原语义，且无需任何 CSS hack。
 *
 * 按钮继续用普通 `<Button variant="ghost">`，不用 AlertDialogAction/Cancel：
 * 三个按钮各自对应不同的应答值（deny / allow / allow_always），
 * 且 allow_always 有二次确认状态机；Action/Cancel 的「点击后关闭」默认行为
 * 在此既不需要、也会干扰。
 */
export function PermissionDialog({
  permission,
  sessionTitle,
  onJump,
}: PermissionDialogProps) {
  return (
    <OccludingAlertDialog
      open
      onOpenChange={() => {
        // 不可关闭：见组件文档。传 no-op 而不是 setState —— Radix 的 AlertDialog
        // 不会响应遮罩点击，但 Esc 仍会调 onOpenChange(false)；若照它关闭，
        // 父级仍认为有待答权限，弹窗会消失而 agent 卡住。
      }}
    >
      <AlertDialogContent className="max-w-md p-6 gap-0">
        <PermissionCard
          permission={permission}
          sessionTitle={sessionTitle}
          onJump={onJump}
          titleAs={AlertDialogTitle}
          descriptionAs={AlertDialogDescription}
        />
      </AlertDialogContent>
    </OccludingAlertDialog>
  );
}
