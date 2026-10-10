import { useState, useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { useEffectiveTheme } from "../../store/selectors";
import type { AppTheme, ThemePreset } from "../../types";
import { VALID_THEME_ACCENTS, type ThemeAccent } from "../../../shared/theme";
import { VALID_THEME_PRESETS } from "../../../shared/theme";
import type { CodemodeMode } from "../../../shared/codemode-config";
import { CODEMODE_MODES } from "../../../shared/codemode-config";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "./shared";
import { Input } from "../ui/input";
import { Button } from "../app-button";
import {
  accentSwatchColor,
  paletteSwatchColor,
} from "../../utils/theme-swatch";

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

  // 色卡取色见 utils/theme-swatch.ts。强调色跟随当前生效主题（"跟随系统"在这里已经解析完）；
  // 调色板取的是该套配色的中性中间调，官方两套里是同一个值，所以不用传明暗。
  const effectiveTheme = useEffectiveTheme();

  // 强调色（与底色正交的第二维）：选项同样从单一真源派生。
  const themeAccentOptions: Array<{
    value: ThemeAccent;
    label: string;
    swatch: ReactNode;
  }> = VALID_THEME_ACCENTS.map((value) => ({
    value,
    label: t(
      `general.themeAccent${value === "default" ? "Default" : value.charAt(0).toUpperCase() + value.slice(1)}`,
    ),
    swatch: (
      <Swatch
        color={accentSwatchColor(value, effectiveTheme, settings.themePreset)}
        shape="dot"
      />
    ),
  }));

  // 选项从单一真源派生：加一套官方配色只需改 shared/theme.ts + i18n，这里不用动。
  const themePresetOptions: Array<{
    value: ThemePreset;
    label: string;
    swatch: ReactNode;
  }> = VALID_THEME_PRESETS.map((value) => ({
    value,
    label: t(
      `general.themePreset${value.charAt(0).toUpperCase()}${value.slice(1)}`,
    ),
    swatch: <Swatch color={paletteSwatchColor(value)} shape="block" />,
  }));

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
                  <Button
                    variant="ghost"
                    key={option.value}
                    type="button"
                    aria-pressed={settings.theme === option.value}
                    onClick={() => updateSettings({ theme: option.value })}
                    className={`px-2.5 py-1 text-xs transition-colors ${
                      settings.theme === option.value
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {option.label}
                  </Button>
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
            title={t("general.themeAccent", "Accent")}
            control={
              <SettingsSelect
                label={t("general.themeAccent", "Accent")}
                data-testid="theme-accent-select"
                value={settings.themeAccent}
                options={themeAccentOptions}
                onChange={(next) => updateSettings({ themeAccent: next })}
              />
            }
          />
          <SettingsRow
            title={t("general.uiFontSize")}
            description={t("general.uiFontSizeDesc")}
            control={
              <>
                <div className="flex items-center rounded-control border border-border bg-card">
                  <Button
                    variant="ghost"
                    aria-label={t("general.uiFontSizeDecrease")}
                    onClick={() => commitFont(settings.uiFontSize - 1)}
                    disabled={settings.uiFontSize <= 12}
                    className="px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 h-auto"
                  >
                    −
                  </Button>
                  <Input
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
                    className="h-auto w-12 rounded-none border-x border-border border-y-0 bg-transparent px-0 py-1 text-center text-xs font-medium text-foreground shadow-none outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <Button
                    variant="ghost"
                    aria-label={t("general.uiFontSizeIncrease")}
                    onClick={() => commitFont(settings.uiFontSize + 1)}
                    disabled={settings.uiFontSize >= 20}
                    className="px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 h-auto"
                  >
                    +
                  </Button>
                </div>
                <span className="text-xs text-muted-foreground">
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

/**
 * 下拉项与触发器上的色卡。两种形状对应两个维度：调色板是圆角方块（该套底色的中性色），
 * 强调色是圆点（那个颜色本身）—— 形状不同，一眼能分清哪排是哪排。
 *
 * 纯装饰：标签文字本来就写着颜色名，所以 aria-hidden，读屏不会多出一个空元素。
 * 圆角不用 rounded-sm/control（最小的那档是 6px）—— 那在 12px 的块上正好是一半，
 * 方块会圆得跟圆点一样，形状的区分就没了。
 */
function Swatch({ color, shape }: { color: string; shape: "block" | "dot" }) {
  return (
    <span
      aria-hidden="true"
      className={`h-3 w-3 flex-none ring-1 ring-inset ring-border ${
        shape === "dot" ? "rounded-full" : "rounded-[3px]"
      }`}
      style={{ backgroundColor: color }}
    />
  );
}
