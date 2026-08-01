import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { PiExtensionManagerView } from "./PiExtensionManagerView";

export function PluginsView() {
  const { t } = useTranslation();
  const setShowPlugins = useAppStore((s) => s.setShowPlugins);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-5 pt-3 pb-0 flex-shrink-0">
        <button
          onClick={() => setShowPlugins(false)}
          aria-label={t("common.back")}
          className="p-1.5 -ml-1.5 rounded-lg hover:bg-surface-hover transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-text-secondary" />
        </button>
        <h2 className="text-base font-semibold tracking-[-0.02em] text-text-primary">
          {t("plugins.title")}
        </h2>
      </div>

      {/* Content */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden px-5 py-6 lg:px-8"
        style={{ scrollbarGutter: "stable" }}
      >
        <div className="max-w-[920px] w-full min-w-0 mx-auto">
          <PiExtensionManagerView />
        </div>
      </div>
    </div>
  );
}
