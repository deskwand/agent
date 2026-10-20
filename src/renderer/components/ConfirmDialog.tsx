import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { OccludingAlertDialog } from "./ui/occluding-dialog";
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  /** 可选副行文案。不传时不渲染任何描述节点。 */
  description?: ReactNode;
  /**
   * 副行的语气。默认 `muted`。
   *
   * `error` 用于「这个操作会打断正在跑的东西」这类告警 —— 承载语义，不是装饰。
   */
  descriptionTone?: "muted" | "error";
  confirmLabel?: string;
  /**
   * 确认键的语气。默认 `danger`：这个原语最早只服务「删除」，
   * 既有调用点不该因为新用法换样子。
   */
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 确认框。
 *
 * 外壳（遮罩、焦点管理、Esc、层级）由 shadcn 的 AlertDialog 承担；
 * occlusion 由 OccludingAlertDialog 承担（迁移前是本组件手写调用）。
 * 本组件只保留内容与语气。
 *
 * `isOpen` 仍是**父级受控**的（与原实现一致）：任何关闭路径都只回调
 * onCancel / onConfirm，由父级决定是否翻 `isOpen`。因此
 *
 *   - 取消键不加 onClick —— Radix 的 Cancel 自会关闭，关闭经由
 *     onOpenChange(false) 回调 onCancel，加 onClick 会**触发两次**
 *   - 确认键显式 preventDefault —— Radix 的 Action 默认也会关闭，
 *     那会让 onOpenChange 紧接着调一次 onCancel，语义上把「确认」报成「取消」
 *
 * Esc 关闭是迁到 Radix 后新增的行为（旧实现没有键盘处理），它同样经
 * onOpenChange 报为取消 —— 对确认框来说这是合理的统一语义。
 */
export function ConfirmDialog({
  isOpen,
  title,
  description,
  descriptionTone = "muted",
  confirmLabel,
  tone = "danger",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <OccludingAlertDialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      {/* 框宽也回到迁移前的紧凑档：vendored 默认是 max-w-lg（512px），
          而确认框通常只有一句话。 */}
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          {/* 字号用正文档（text-sm / 14px），不能用 vendored 的默认
              `text-lg font-semibold`（18px）：迁移前这条文案就是 `text-sm`，
              确认框问的是一句话，不是区块标题。刻意与同档小弹窗对齐
              （AddServerDialog / KeyDialog / MailAccountDialog 都是
              `DialogTitle text-sm font-medium`）。改之前先看
              tests/renderer/confirm-dialog.test.tsx 里钉尺寸的那条。 */}
          <AlertDialogTitle className="text-sm font-medium">
            {title}
          </AlertDialogTitle>
          {/* 描述是可选的：不传时不渲染任何额外节点（大多数调用点就是这种）。
              传了就用它补充上下文 ——
              但**不要**用它复述标题文案，那会让读屏经 aria-labelledby 与
              aria-describedby 把同一句话念两遍。 */}
          {description ? (
            <AlertDialogDescription
              // 字号**不动**，用 vendored 的默认（text-sm）。两个调用点的原实现
              // 本来就不一样（ConnectorsView 是 text-xs、Sidebar 是 text-sm），
              // 为抹平它去加一个 descriptionClassName prop 是没必要的 API 面积 ——
              // D2 已授权「以 shadcn 默认观感为准」，差异记在 ledger 里。
              // 只有**语气**必须保留，因为那承载语义（告警 vs 说明）。
              className={
                descriptionTone === "error" ? "text-destructive" : undefined
              }
            >
              {description}
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // 见上方注释：阻止 Radix 的隐式关闭，避免 onCancel 被连带触发
              event.preventDefault();
              onConfirm();
            }}
            className={
              tone === "primary"
                ? "bg-primary/10 text-primary-text hover:bg-primary/20"
                : "bg-destructive/10 text-destructive hover:bg-destructive/20"
            }
          >
            {confirmLabel ?? t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </OccludingAlertDialog>
  );
}
