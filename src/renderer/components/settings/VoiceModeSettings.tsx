/**
 * @module renderer/components/settings/VoiceModeSettings
 *
 * 「能力」区块里的语音对话。只有一个设置项：最多等多久。
 *
 * 它的语义已经从"静音多久算说完"改成"**最多等你多久**"：说完了由句末标点
 * 判定，这个值退成硬上限——判定说你没说完时，最多再等这么久就收尾。
 * 数值与档位刻意没动（400–2000ms、默认 1200），只改文案：改下限会造出一条
 * 静默迁移，而症状集并不要求放宽范围。
 *
 * 它没有开关（开关就是浮层本身）、也没有下载物（模型与语音输入共用同一套），
 * 所以这张卡比朗读那张薄得多。
 *
 * 用下拉而不是滑杆：设置区没有滑杆控件，六档选择更好点中，也不必为一项设置
 * 引入新控件。
 */
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { DEFAULT_VOICE_MODE } from "../../../shared/voice-mode";
import { SettingsCard, SettingsRow, SettingsSelect } from "./shared";

const isElectron =
  typeof window !== "undefined" && window.electronAPI !== undefined;

/** 六档覆盖从"急性子"到"慢条斯理"，两端就是 shared 里的夹取边界。 */
const SILENCE_CHOICES = ["400", "600", "800", "1000", "1500", "2000"] as const;

type SilenceChoice = (typeof SILENCE_CHOICES)[number];

export function VoiceModeSettings() {
  const { t } = useTranslation();
  const appConfig = useAppStore((s) => s.appConfig);
  const setAppConfig = useAppStore((s) => s.setAppConfig);

  const current = String(
    appConfig?.voiceMode?.silenceMs ?? DEFAULT_VOICE_MODE.silenceMs,
  ) as SilenceChoice;

  /** 与朗读、语音输入同一条管线：写 AppConfig，再同步 store。 */
  const change = async (next: SilenceChoice) => {
    if (!isElectron) return;
    const saved = await window.electronAPI?.config?.save({
      voiceMode: { silenceMs: Number(next) },
    });
    if (saved?.config) setAppConfig(saved.config);
  };

  return (
    <SettingsCard>
      <SettingsRow
        testId="voice-mode-card"
        title={t("settings.capabilities.voiceMode.title")}
        description={t("settings.capabilities.voiceMode.desc")}
        control={
          <SettingsSelect<SilenceChoice>
            label={t("settings.capabilities.voiceMode.silenceLabel")}
            value={current}
            options={SILENCE_CHOICES.map((value) => ({
              value,
              label: t("settings.capabilities.voiceMode.silenceValue", {
                ms: value,
              }),
            }))}
            onChange={(next) => void change(next)}
          />
        }
      />
    </SettingsCard>
  );
}
