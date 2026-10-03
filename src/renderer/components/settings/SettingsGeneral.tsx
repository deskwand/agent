import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import type { AppTheme, ThemePreset } from "../../types";
import type { CodemodeMode } from "../../../shared/codemode-config";
import { CODEMODE_MODES } from "../../../shared/codemode-config";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "./shared";

export function SettingsGeneral() {
  const { i18n, t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const appConfig = useAppStore((s) => s.appConfig);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const currentLang = i18n.language.startsWith("zh") ? "zh" : "en";

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

  // codemode 属于主进程配置（appConfig），与 webAccess 同一条管线 —— **不是** UI 偏好那条
  // （`updateSettings` 走的是 `settings.update`，与 AppConfig 无关）。
  const saveCodemode = async (
    patch: Partial<NonNullable<typeof appConfig>["codemode"]>,
  ) => {
    if (!appConfig || !window.electronAPI) return;
    const next = { ...appConfig.codemode, ...patch };
    const saved = await window.electronAPI.config.save({ codemode: next });
    if (saved?.config) setAppConfig(saved.config);
  };

  const handleFontDraftCommit = () => {
    const v = Number(fontDraft);
    commitFont(Number.isFinite(v) ? v : settings.uiFontSize);
  };

  const languageOptions = [
    { value: "en" as const, label: "English" },
    { value: "zh" as const, label: "中文" },
  ];

  const themeOptions: Array<{ value: AppTheme; label: string }> = [
    { value: "light", label: t("general.themeLight") },
    { value: "dark", label: t("general.themeDark") },
    { value: "system", label: t("general.themeSystem", "System") },
  ];

  const themePresetOptions: Array<{ value: ThemePreset; label: string }> = [
    { value: "graphite", label: t("general.themePresetGraphite", "Graphite") },
    { value: "paper", label: t("general.themePresetPaper", "Paper") },
    { value: "void", label: t("general.themePresetVoid", "Void") },
    { value: "ocean", label: t("general.themePresetOcean", "Ocean") },
    { value: "forest", label: t("general.themePresetForest", "Forest") },
    { value: "ember", label: t("general.themePresetEmber", "Ember") },
    { value: "aurora", label: t("general.themePresetAurora", "Aurora") },
  ];

  const codemodeModeOptions: Array<{ value: CodemodeMode; label: string }> =
    CODEMODE_MODES.map((mode) => ({
      value: mode,
      label: t(`general.codemodeMode_${mode}`),
    }));

  return (
    <div className="space-y-6">
      <SettingsSection title={t("general.appearance")}>
        <SettingsCard>
          <SettingsRow
            title={t("general.theme")}
            control={
              // 只有一个调用点，所以不抽成公共原语。
              <div
                role="group"
                aria-label={t("general.theme")}
                className="flex overflow-hidden rounded-control border border-border"
              >
                {themeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={settings.theme === option.value}
                    onClick={() => updateSettings({ theme: option.value })}
                    className={`px-2.5 py-1 text-xs transition-colors ${
                      settings.theme === option.value
                        ? "bg-surface-active text-text-primary"
                        : "text-text-secondary hover:bg-surface-hover"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            }
          />
          <SettingsRow
            title={t("general.themePreset", "Palette")}
            control={
              <SettingsSelect
                label={t("general.themePreset", "Palette")}
                value={settings.themePreset}
                options={themePresetOptions}
                onChange={(next) => updateSettings({ themePreset: next })}
              />
            }
          />
          <SettingsRow
            title={t("general.uiFontSize")}
            description={t("general.uiFontSizeDesc")}
            control={
              <>
                <div className="flex items-center rounded-control border border-border bg-surface">
                  <button
                    aria-label={t("general.uiFontSizeDecrease")}
                    onClick={() => commitFont(settings.uiFontSize - 1)}
                    disabled={settings.uiFontSize <= 12}
                    className="px-2 py-1 text-xs text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={12}
                    max={20}
                    aria-label={t("general.uiFontSize")}
                    value={fontDraft}
                    onChange={(e) => setFontDraft(e.target.value)}
                    onBlur={handleFontDraftCommit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleFontDraftCommit();
                    }}
                    className="w-12 border-x border-border bg-transparent py-1 text-center text-xs font-medium text-text-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <button
                    aria-label={t("general.uiFontSizeIncrease")}
                    onClick={() => commitFont(settings.uiFontSize + 1)}
                    disabled={settings.uiFontSize >= 20}
                    className="px-2 py-1 text-xs text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
                <span className="text-xs text-text-muted">
                  {t("general.uiFontSizeUnit", "PX")}
                </span>
              </>
            }
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t("settings.general")}>
        <SettingsCard>
          <SettingsRow
            title={t("general.language")}
            control={
              <SettingsSelect
                label={t("general.language")}
                value={currentLang}
                options={languageOptions}
                onChange={(next) => void i18n.changeLanguage(next)}
              />
            }
          />
          <SettingsRow
            title={t("general.autoSkillLearning")}
            description={`${t("general.autoSkillLearningDesc")} ${t(
              "general.autoSkillLearningProjectNote",
            )}`}
            control={
              <SettingsSwitch
                label={t("general.autoSkillLearning")}
                checked={settings.autoSkillLearning}
                onChange={(next) => updateSettings({ autoSkillLearning: next })}
              />
            }
          />
          {/* codemode 没有开关：它的激活是派生的（有 exposure=codemode 的 MCP 服务连上时由
              上游激活）。要让它不生效，请在该服务的设置里把 exposure 改成「直接声明」，
              或在 mcp.json 顶层写 autoEnableCodemode: false。 */}
          <SettingsRow
            title={t("general.codemode")}
            description={`${t("general.codemodeDesc")} ${t(
              "general.codemodeModeNote",
            )}`}
            control={
              <SettingsSelect
                label={t("general.codemode")}
                value={appConfig?.codemode?.mode ?? "on"}
                options={codemodeModeOptions}
                onChange={(next) => void saveCodemode({ mode: next })}
              />
            }
          />
          <SettingsRow
            title={t("general.codemodeInlineBudget")}
            description={t("general.codemodeInlineBudgetNote")}
            control={
              <input
                type="number"
                min={0}
                aria-label={t("general.codemodeInlineBudget")}
                value={appConfig?.codemode?.inlineBudget ?? 3000}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (!Number.isFinite(value) || value < 0) return;
                  void saveCodemode({ inlineBudget: Math.floor(value) });
                }}
                className="w-24 rounded-control border border-border bg-surface px-2.5 py-1 text-xs text-text-primary outline-none"
              />
            }
          />
          <SettingsRow
            title={t("general.telemetry")}
            description={t("general.telemetryDesc")}
            control={
              <SettingsSwitch
                label={t("general.telemetry")}
                checked={settings.telemetryEnabled}
                onChange={(next) => updateSettings({ telemetryEnabled: next })}
              />
            }
          />
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
