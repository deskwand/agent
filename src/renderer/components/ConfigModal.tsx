import { Key } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AppConfig } from "../types";
import { SettingsAPI } from "./settings/SettingsAPI";
import { OccludingDialog } from "./ui/occluding-dialog";
import { DialogContent, DialogTitle } from "./ui/dialog";

interface ConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: Partial<AppConfig>) => Promise<void>;
  initialConfig?: AppConfig | null;
  isFirstRun?: boolean;
}

/**
 * 全屏设置面板。
 *
 * 外壳由 shadcn Dialog 承担，occlusion 由 OccludingDialog 承担
 *（迁移前这里是 modal-overlay 但**漏了** useBrowserOcclusion ——
 *  14 个弹窗里唯一缺失 occlusion 的那个，既有实现的不一致，此处一并修好）。
 *
 * 内容、i18n key、图标与 SettingsAPI 的嵌入方式均未改。
 *
 * 两个刻意的取舍：
 *   - 不再自渲染右上角的关闭 X，改用 DialogContent 内置的那个。原实现自己有一个，
 *     两个都留会在同一角落叠出两个关闭键；用 CSS 隐藏内置键既难测又是不必要的 hack。
 *   - 遮罩由 shadcn 的 DialogOverlay 提供（bg-black/80，无 backdrop blur），
 *     与原 modal-overlay 的 rgba(0,0,0,.35) + blur(12px) 不同。这是 D2
 *     「以 shadcn 默认观感为准」的直接结果，非疏漏。
 */
export function ConfigModal({ isOpen, onClose, isFirstRun }: ConfigModalProps) {
  const { t } = useTranslation();

  return (
    <OccludingDialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex max-h-[88vh] w-full max-w-[960px] flex-col gap-0 overflow-hidden p-0">
        <div className="flex items-center gap-3 border-b border-border-muted bg-background/90 px-6 py-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border-subtle bg-background-secondary/90 text-primary">
            <Key className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-text-muted">
              {t("settings.title")}
            </p>
            <DialogTitle className="mt-1 text-sm font-semibold tracking-[-0.02em] text-text-primary">
              {isFirstRun ? t("api.firstRunTitle") : t("api.settingsTitle")}
            </DialogTitle>
            <p className="text-sm text-text-secondary">
              {isFirstRun
                ? t("api.firstRunSubtitle")
                : t("api.settingsSubtitle")}
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-background/70 p-6">
          <SettingsAPI embedded onSaved={onClose} />
        </div>
      </DialogContent>
    </OccludingDialog>
  );
}
