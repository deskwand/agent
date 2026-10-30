import { useState, type ElementType } from "react";
import { useTranslation } from "react-i18next";
import { useIPC } from "../../hooks/useIPC";
import type { PermissionRequest } from "../../types";
import { Shield, X, Check, AlertTriangle } from "lucide-react";
import { Button } from "../app-button";

export interface PermissionCardProps {
  permission: PermissionRequest;
  extraCount?: number;
  sessionTitle?: string;
  onJump?: () => void;
  /** Dialog 外壳传入 AlertDialogTitle / Description 以保留读屏语义；默认普通元素。 */
  titleAs?: ElementType;
  descriptionAs?: ElementType;
}

/** 授权请求卡片主体：Dialog 外壳与分屏区域内联展示共用。 */
export function PermissionCard({
  permission,
  extraCount,
  sessionTitle,
  onJump,
  titleAs: TitleTag = "h3",
  descriptionAs: DescriptionTag = "p",
}: PermissionCardProps) {
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
    <div>
      {sessionTitle && (
        <div className="mb-3 flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span className="truncate">
            {t("split.permissionFromSession", { name: sessionTitle })}
          </span>
          {onJump && (
            <Button
              variant="ghost"
              onClick={onJump}
              className="h-auto flex-shrink-0 rounded-lg px-2 py-1 text-sm text-primary-text hover:bg-hover-surface"
            >
              {t("split.jumpToSession")}
            </Button>
          )}
        </div>
      )}
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
          <TitleTag className="text-lg font-semibold text-foreground">
            {t("permission.permissionRequired")}
          </TitleTag>
          {/* Description 供读屏补充一句上下文（Radix 不强制要求）。
              这里用它承载工具描述，读屏用户听到的就是这段。 */}
          <DescriptionTag className="text-sm text-muted-foreground mt-1">
            {getToolDescription(permission.toolName)}
          </DescriptionTag>
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
        <Button
          variant="ghost"
          onClick={() => respondToPermission(permission.toolUseId, "deny")}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-hover-surface h-auto"
        >
          <X className="w-4 h-4" />
          {t("permission.deny")}
        </Button>

        <Button
          variant="ghost"
          onClick={() => respondToPermission(permission.toolUseId, "allow")}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 h-auto"
        >
          <Check className="w-4 h-4" />
          {t("permission.allow")}
        </Button>
      </div>

      {/* Always Allow option */}
      {!pendingAlwaysAllow ? (
        <Button
          variant="ghost"
          onClick={() => {
            const dangerousTools = ["bash", "write", "edit", "execute_command"];
            const isDangerous = dangerousTools.some((tool) =>
              permission.toolName?.toLowerCase().includes(tool),
            );
            if (isDangerous) {
              setPendingAlwaysAllow(true);
            } else {
              respondToPermission(permission.toolUseId, "allow_always");
            }
          }}
          className="w-full mt-2 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-hover-surface h-auto"
        >
          {t("permission.alwaysAllow")}
        </Button>
      ) : (
        <div className="mt-2 p-3 bg-warning/10 border border-warning/20 rounded-xl">
          <p className="text-sm text-warning mb-2">
            {t("permission.alwaysAllowConfirm", {
              toolName: permission.toolName,
            })}
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => setPendingAlwaysAllow(false)}
              className="flex-1 rounded-lg bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-hover-surface h-auto"
            >
              {t("permission.cancelAlwaysAllow")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setPendingAlwaysAllow(false);
                respondToPermission(permission.toolUseId, "allow_always");
              }}
              className="flex-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 h-auto"
            >
              {t("permission.confirmAlwaysAllow")}
            </Button>
          </div>
        </div>
      )}
      {extraCount ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("split.morePermissions", { count: extraCount })}
        </p>
      ) : null}
    </div>
  );
}
