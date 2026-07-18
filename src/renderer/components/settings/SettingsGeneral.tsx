import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";

export function SettingsGeneral() {
  const { i18n, t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const currentLang = i18n.language.startsWith("zh") ? "zh" : "en";
  const [appVer, setAppVer] = useState("");
  useEffect(() => {
    try {
      const v = window.electronAPI?.getVersion?.();
      if (v instanceof Promise) v.then(setAppVer);
      else if (v) setAppVer(v);
    } catch {
      /* ignore */
    }
  }, []);

  const languages = [
    { code: "en", nativeName: "English" },
    { code: "zh", nativeName: "中文" },
  ];

  const themeOptions = [
    { value: "light" as const, label: t("general.themeLight") },
    { value: "dark" as const, label: t("general.themeDark") },
    { value: "system" as const, label: t("general.themeSystem", "System") },
  ];

  const themePresets = [
    {
      value: "graphite" as const,
      label: t("general.themePresetGraphite", "Graphite"),
    },
    { value: "paper" as const, label: t("general.themePresetPaper", "Paper") },
    { value: "void" as const, label: t("general.themePresetVoid", "Void") },
    { value: "ocean" as const, label: t("general.themePresetOcean", "Ocean") },
    { value: "forest" as const, label: t("general.themePresetForest", "Forest") },
    { value: "ember" as const, label: t("general.themePresetEmber", "Ember") },
    { value: "aurora" as const, label: t("general.themePresetAurora", "Aurora") },
  ];

  return (
    <div className="space-y-6">
      {/* Theme */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">
          {t("general.appearance")}
        </h4>
        <div className="flex gap-2">
          {themeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateSettings({ theme: opt.value })}
              className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                settings.theme === opt.value
                  ? "border-accent bg-accent/5 text-text-primary"
                  : "border-border bg-surface hover:border-accent/50 text-text-secondary"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Theme Preset */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">
          {t("general.themePreset", "Palette")}
        </h4>
        <div className="flex gap-2 flex-wrap">
          {themePresets.map((preset) => (
            <button
              key={preset.value}
              onClick={() => updateSettings({ themePreset: preset.value })}
              className={`px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                settings.themePreset === preset.value
                  ? "border-accent bg-accent/5 text-text-primary"
                  : "border-border bg-surface hover:border-accent/50 text-text-secondary"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Language */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">
          {t("general.language")}
        </h4>
        <div className="flex gap-2">
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => i18n.changeLanguage(lang.code)}
              className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                currentLang === lang.code
                  ? "border-accent bg-accent/5 text-text-primary"
                  : "border-border bg-surface hover:border-accent/50 text-text-secondary"
              }`}
            >
              {lang.nativeName}
            </button>
          ))}
        </div>
      </div>

      {/* Auto Skill Learning */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">
          {t("general.autoSkillLearning")}
        </h4>
        <p className="text-xs text-text-muted">
          {t("general.autoSkillLearningDesc")}
        </p>
        <p className="text-xs text-text-muted">
          {t("general.autoSkillLearningProjectNote")}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => updateSettings({ autoSkillLearning: true })}
            className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
              settings.autoSkillLearning
                ? "border-accent bg-accent/5 text-text-primary"
                : "border-border bg-surface hover:border-accent/50 text-text-secondary"
            }`}
          >
            {t("common.enable")}
          </button>
          <button
            onClick={() => updateSettings({ autoSkillLearning: false })}
            className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
              !settings.autoSkillLearning
                ? "border-accent bg-accent/5 text-text-primary"
                : "border-border bg-surface hover:border-accent/50 text-text-secondary"
            }`}
          >
            {t("common.disable")}
          </button>
        </div>
      </div>

      {/* Telemetry */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">
          {t("general.telemetry")}
        </h4>
        <p className="text-xs text-text-muted">
          {t("general.telemetryDesc")}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => updateSettings({ telemetryEnabled: true })}
            className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
              settings.telemetryEnabled
                ? "border-accent bg-accent/5 text-text-primary"
                : "border-border bg-surface hover:border-accent/50 text-text-secondary"
            }`}
          >
            {t("common.enable")}
          </button>
          <button
            onClick={() => updateSettings({ telemetryEnabled: false })}
            className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
              !settings.telemetryEnabled
                ? "border-accent bg-accent/5 text-text-primary"
                : "border-border bg-surface hover:border-accent/50 text-text-secondary"
            }`}
          >
            {t("common.disable")}
          </button>
        </div>
      </div>

      {/* About */}
      {appVer && (
        <div className="pt-4 border-t border-border">
          <p className="text-xs text-text-muted">DeskWand v{appVer}</p>
        </div>
      )}
    </div>
  );
}
