import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useIPC } from "../hooks/useIPC";
import type { PermissionRequest } from "../types";
import { Shield, X, Check, AlertTriangle } from "lucide-react";
import { OccludingAlertDialog } from "./ui/occluding-dialog";
import {
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./app-button";

interface PermissionDialogProps {
  permission: PermissionRequest;
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
export function PermissionDialog({ permission }: PermissionDialogProps) {
  const { t } = useTranslation();
  const { respondToPermission } = useIPC();
  const [pendingAlwaysAllow, setPendingAlwaysAllow] = useState(false);

  const getToolDescription = (toolName: string): string => {
    const key = `permission.toolDescriptions.${toolName}`;
    const translated = t(key);
    // 没有专门描述时回落到通用文案（i18n 会把缺失 key 原样返回）
    if (translated === key) {
      return t("permission.useTool", { toolName });
    }
    return translated;
  };

  // 行为与迁移前一致：这六个工具都按高危处理。写文件类也要 —— 高危提示不能只覆盖 bash。
  // 迁移时曾误删 write_file / edit_file —— 这条清单没有测试钉着，所以静默通过了。
  // 现由 permission-dialog-shell.test.tsx 的用例锁住。
  const isHighRisk = [
    "bash",
    "write",
    "edit",
    "execute_command",
    "write_file",
    "edit_file",
  ].includes(permission.toolName);

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
        {/* Header */}
        <div className="flex items-start gap-4">
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
              isHighRisk ? "bg-warning/10" : "bg-primary/10"
            }`}
          >
            {isHighRisk ? (
              <AlertTriangle className="w-6 h-6 text-warning" />
            ) : (
              <Shield className="w-6 h-6 text-primary-text" />
            )}
          </div>

          <div className="flex-1">
            <AlertDialogTitle className="text-lg font-semibold text-foreground">
              {t("permission.permissionRequired")}
            </AlertDialogTitle>
            {/* Description 供读屏补充一句上下文（Radix 不强制要求）。
                这里用它承载工具描述，读屏用户听到的就是这段。 */}
            <AlertDialogDescription className="text-sm text-muted-foreground mt-1">
              {getToolDescription(permission.toolName)}
            </AlertDialogDescription>
          </div>
        </div>

        {/* Tool Details */}
        <div className="mt-4 p-4 bg-muted rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-medium text-foreground">
              {t("permission.tool")}
            </span>
            <span className="font-mono text-primary-text text-sm">
              {permission.toolName}
            </span>
          </div>

          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {t("permission.input")}
            </span>
            <pre className="mt-1 text-xs code-block max-h-32 overflow-auto">
              {JSON.stringify(permission.input, null, 2)}
            </pre>
          </div>
        </div>

        {/* Warning */}
        {isHighRisk && (
          <div className="mt-4 p-3 bg-warning/10 border border-warning/20 rounded-xl">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
              <p className="text-sm text-warning">{t("permission.warning")}</p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex items-center gap-3">
          <Button variant="ghost"
            onClick={() => respondToPermission(permission.toolUseId, "deny")}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent h-auto"
          >
            <X className="w-4 h-4" />
            {t("permission.deny")}
          </Button>

          <Button variant="ghost"
            onClick={() => respondToPermission(permission.toolUseId, "allow")}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 h-auto"
          >
            <Check className="w-4 h-4" />
            {t("permission.allow")}
          </Button>
        </div>

        {/* Always Allow option */}
        {!pendingAlwaysAllow ? (
          <Button variant="ghost"
            onClick={() => {
              const dangerousTools = [
                "bash",
                "write",
                "edit",
                "execute_command",
              ];
              const isDangerous = dangerousTools.some((tool) =>
                permission.toolName?.toLowerCase().includes(tool),
              );
              if (isDangerous) {
                setPendingAlwaysAllow(true);
              } else {
                respondToPermission(permission.toolUseId, "allow_always");
              }
            }}
            className="w-full mt-2 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent h-auto"
          >
            {t("permission.alwaysAllow")}
          </Button>
        ) : (
          <div className="mt-2 p-3 bg-warning/10 border border-warning/20 rounded-xl">
            <p className="text-sm text-warning mb-2">
              {`Are you sure you want to always allow "${permission.toolName}"? This tool can modify your system.`}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost"
                onClick={() => setPendingAlwaysAllow(false)}
                className="flex-1 rounded-lg bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent h-auto"
              >
                {t("permission.deny")}
              </Button>
              <Button variant="ghost"
                onClick={() => {
                  setPendingAlwaysAllow(false);
                  respondToPermission(permission.toolUseId, "allow_always");
                }}
                className="flex-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 h-auto"
              >
                {t("permission.alwaysAllow")}
              </Button>
            </div>
          </div>
        )}
      </AlertDialogContent>
    </OccludingAlertDialog>
  );
}
