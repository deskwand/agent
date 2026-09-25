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

  const [fontDraft, setFontDraft] = useState<string>(
    String(settings.uiFontSize),
  );

  // Sync the draft with the committed setting (e.g. when toggled via +/- buttons).
  useEffect(() => {
    setFontDraft(String(settings.uiFontSize));
  }, [settings.uiFontSize]);

  const commitFont = (value: number) => {
    const clamped = Math.min(20, Math.max(12, Math.round(value)));
    updateSettings({ uiFontSize: clamped });
    setFontDraft(String(clamped));
  };

  const handleFontDraftCommit = () => {
    const v = Number(fontDraft);
    commitFont(Number.isFinite(v) ? v : settings.uiFontSize);
  };

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
    {
      value: "forest" as const,
      label: t("general.themePresetForest", "Forest"),
    },
    { value: "ember" as const, label: t("general.themePresetEmber", "Ember") },
    {
      value: "aurora" as const,
      label: t("general.themePresetAurora", "Aurora"),
    },
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

      {/* UI Font Size */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">
          {t("general.uiFontSize")}
        </h4>
        <p className="text-xs text-text-muted">{t("general.uiFontSizeDesc")}</p>
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-lg border border-border bg-surface">
            <button
              aria-label="decrease font size"
              onClick={() => commitFont(settings.uiFontSize - 1)}
              disabled={settings.uiFontSize <= 12}
              className="px-3 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              −
            </button>
            <input
              type="number"
              min={12}
              max={20}
              value={fontDraft}
              onChange={(e) => setFontDraft(e.target.value)}
              onBlur={handleFontDraftCommit}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleFontDraftCommit();
              }}
              className="w-16 border-x border-border bg-transparent py-2 text-center text-sm font-medium text-text-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <button
              aria-label="increase font size"
              onClick={() => commitFont(settings.uiFontSize + 1)}
              disabled={settings.uiFontSize >= 20}
              className="px-3 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              +
            </button>
          </div>
          <span className="text-sm text-text-muted">
            {t("general.uiFontSizeUnit", "PX")}
          </span>
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
        <p className="text-xs text-text-muted">{t("general.telemetryDesc")}</p>
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
        <div className="pt-4 border-t border-border-muted">
          <p className="text-xs text-text-muted">DeskWand v{appVer}</p>
        </div>
      )}
    </div>
  );
}
