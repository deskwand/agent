/**
 * @module renderer/components/settings/CloudVoiceSettings
 *
 * 「语音」卡在来源=云端时展开的区块。交互稿：design-docs/2026-10-08-云端TTS-设置卡-mockup.html
 *
 * 三条纪律（设计 §5）：音质映射折进「高级」；provider 声明的档位映射是只读的；
 * 未实测的端点如实标注，不假装它有流式。
 *
 * 音色只在**这里**策展一份，主进程那份（`providers/doubao.ts` 的 `curatedVoices`）
 * 是给协议层用的 —— 渲染进程不许 import 主进程模块（跨进程只走 IPC），所以两边
 * 各存一份；provider id 的一致性由 `src/tests/tts/cloud-presets.test.ts` 钉住。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  CloudVoiceConfig,
  VoiceModeConfig,
} from "../../../shared/voice-mode";
import { SettingsRow, SettingsSelect, SettingsStatusBadge } from "./shared";
import { useTtsPreview } from "../../hooks/useTtsPreview";
import { Input } from "../ui/input";

import {
  CURATED_VOICES_FOR_UI,
  PRESETS_FOR_UI,
  PROVIDER_IDS_FOR_UI,
} from "./cloud-voice-catalog";
import { Button } from "../app-button";

export { PRESETS_FOR_UI, PROVIDER_IDS_FOR_UI };

/** 设置卡里没有 raw input 的先例，样式在一处定义，别在 5 个地方各写一遍。 */
const FIELD_CLASS =
  "w-64 rounded-control border border-border bg-card px-2 py-1 text-sm text-foreground";

const PROVIDERS = [
  {
    id: "openai-compatible",
    labelKey: "cloud.providerOpenaiCompatible",
    credLabelKey: "cloud.apiKey",
    hintKey: "cloud.hintOpenaiCompatible",
    needsBaseUrl: true,
    declaredTiers: null,
    streaming: true,
  },
  {
    id: "doubao",
    labelKey: "cloud.providerDoubao",
    credLabelKey: "cloud.doubaoKey",
    hintKey: "cloud.hintDoubao",
    hintWarn: true,
    needsBaseUrl: false,
    declaredTiers: {
      fast: "seed-tts-2.0-standard",
      balanced: "seed-tts-2.0-standard",
      best: "seed-tts-2.0-expressive",
    },
    streaming: true,
  },
] as const satisfies ReadonlyArray<{
  id: (typeof PROVIDER_IDS_FOR_UI)[number];
  labelKey: string;
  credLabelKey: string;
  hintKey: string;
  hintWarn?: boolean;
  needsBaseUrl: boolean;
  declaredTiers: Record<"fast" | "balanced" | "best", string> | null;
  streaming: boolean;
}>;

const TIERS = ["fast", "balanced", "best"] as const;

/** 档位名复用音质那三档的既有 key，避免同义词又长出第三份。 */
const TIER_LABEL: Record<(typeof TIERS)[number], string> = {
  fast: "toneFast",
  balanced: "toneBalanced",
  best: "toneBest",
};

export function CloudVoiceSettings({
  voiceMode,
  onPatch,
}: {
  voiceMode: VoiceModeConfig;
  onPatch: (
    update: (current: CloudVoiceConfig) => CloudVoiceConfig,
  ) => Promise<void>;
}) {
  const { t } = useTranslation();
  const KEY = "settings.capabilities.voiceMode";
  const cloud = voiceMode.cloud ?? {};
  const provider =
    PROVIDERS.find((p) => p.id === cloud.provider) ?? PROVIDERS[0];
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // 试听是用户**唯一**能自己验证 Key 通不通的入口（设计 §5）；它走 ipc 的
  // `tts.preview`，那条路已按来源分派到云端。
  const preview = useTtsPreview();
  const previewError = preview.error
    ? preview.errorCode
      ? t(`${KEY}.cloud.error.${preview.errorCode}`)
      : preview.error
    : null;
  const [splitTiers, setSplitTiers] = useState(false);
  const credValue = cloud.credentials?.[provider.id]?.apiKey ?? "";
  const voices = CURATED_VOICES_FOR_UI[provider.id] ?? [];
  const matchedPreset = PRESETS_FOR_UI.find((p) => p.baseUrl === cloud.baseUrl);
  const patch = (next: Partial<CloudVoiceConfig>) =>
    void onPatch((current) => ({ ...current, ...next }));

  /**
   * **实际会用的音色**：配置里的优先，否则就是下面下拉里显示的那个策展音色。
   * 徽标必须跟它对齐 —— 显示一个默认音色、却报「未配置凭据」是界面在说假话。
   */
  const effectiveVoice = cloud.voiceId || voices[0]?.id || "";
  const badge = !cloud.provider
    ? { tone: "error" as const, label: t(`${KEY}.cloud.state.unconfigured`) }
    : !credValue
      ? { tone: "error" as const, label: t(`${KEY}.cloud.state.unconfigured`) }
      : !effectiveVoice
        ? { tone: "error" as const, label: t(`${KEY}.cloud.state.noVoice`) }
        : { tone: "ok" as const, label: t(`${KEY}.cloud.state.ready`) };

  return (
    <>
      <SettingsRow
        title={t(`${KEY}.cloud.endpoint`)}
        testId="cloud-endpoint"
        control={
          <SettingsSelect
            value={provider.id}
            label={t(`${KEY}.cloud.endpoint`)}
            testId="cloud-endpoint-select"
            options={PROVIDERS.map((p) => ({
              value: p.id,
              label: t(`${KEY}.${p.labelKey}`),
            }))}
            onChange={(id) => patch({ provider: id })}
          />
        }
      />
      {provider.needsBaseUrl && (
        <SettingsRow
          sub
          title={t(`${KEY}.cloud.preset`)}
          testId="cloud-preset"
          // 未实测的预设**如实标注**：界面对自己不知道的事不能装作知道
          description={
            matchedPreset && !matchedPreset.verified
              ? t(`${KEY}.cloud.presetUnverified`)
              : undefined
          }
          control={
            <SettingsSelect
              value={matchedPreset?.id ?? "custom"}
              label={t(`${KEY}.cloud.preset`)}
              testId="cloud-preset-select"
              options={[
                ...PRESETS_FOR_UI.map((p) => ({
                  value: p.id as string,
                  label: t(`${KEY}.${p.labelKey}`),
                })),
                { value: "custom", label: t(`${KEY}.cloud.presetCustom`) },
              ]}
              onChange={(id) => {
                const preset = PRESETS_FOR_UI.find((p) => p.id === id);
                // 选「自定义」只把 BaseURL 清空，不碰其它字段
                patch({ baseUrl: preset ? preset.baseUrl : "" });
              }}
            />
          }
        />
      )}
      {provider.needsBaseUrl && (
        <SettingsRow
          sub
          title={t(`${KEY}.cloud.baseUrl`)}
          testId="cloud-baseurl"
          control={
            <Input
              data-testid="cloud-baseurl-input"
              className={FIELD_CLASS}
              value={cloud.baseUrl ?? ""}
              placeholder="https://…/v1"
              onChange={(e) => patch({ baseUrl: e.target.value })}
            />
          }
        />
      )}
      <SettingsRow
        sub
        title={t(`${KEY}.${provider.credLabelKey}`)}
        description={t(`${KEY}.${provider.hintKey}`)}
        testId="cloud-credential"
        control={
          <Input
            data-testid="cloud-credential-input"
            type="password"
            className={FIELD_CLASS}
            value={credValue}
            onChange={(e) => {
              // 先把值抄下来：下面那个更新函数可能在事件回收之后才被调用
              const apiKey = e.target.value;
              void onPatch((current) => ({
                ...current,
                credentials: {
                  ...(current.credentials ?? {}),
                  [provider.id]: { apiKey },
                },
              }));
            }}
          />
        }
      />
      <SettingsRow
        sub
        title={t(`${KEY}.cloud.voice`)}
        testId="cloud-voice"
        control={
          voices.length > 0 ? (
            <SettingsSelect
              value={cloud.voiceId ?? voices[0].id}
              label={t(`${KEY}.cloud.voice`)}
              testId="cloud-voice-select"
              options={voices.map((v) => ({
                value: v.id,
                label: t(`${KEY}.${v.labelKey}`),
              }))}
              onChange={(id) => patch({ voiceId: id })}
            />
          ) : (
            <Input
              data-testid="cloud-voice-input"
              className={FIELD_CLASS}
              value={cloud.voiceId ?? ""}
              placeholder={t(`${KEY}.cloud.voicePlaceholder`)}
              onChange={(e) => patch({ voiceId: e.target.value })}
            />
          )
        }
      />
      <SettingsRow
        title={t(`${KEY}.cloud.status`)}
        testId="cloud-status"
        control={
          <SettingsStatusBadge
            tone={badge.tone}
            label={badge.label}
            testId="cloud-status-badge"
          />
        }
      />
      <SettingsRow
        title={t(`${KEY}.cloud.preview`)}
        testId="cloud-preview"
        control={
          <div className="flex flex-col items-start gap-1">
            <Button variant="ghost"
              type="button"
              data-testid="cloud-preview-button"
              className="w-20 rounded-control border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
              onClick={() => {
                if (preview.state === "playing") preview.stop();
                else void preview.play(voiceMode.tone ?? "balanced");
              }}
            >
              {preview.state === "idle"
                ? t(`${KEY}.tonePreview`)
                : preview.state === "busy"
                  ? t(`${KEY}.tonePreviewBusy`)
                  : t(`${KEY}.tonePreviewStop`)}
            </Button>
            {previewError && (
              <div className="flex flex-col gap-0.5">
                {/* 四类错误码在这里落成文案（设计 §6「UI 文案与它一一对应」） */}
                <span
                  data-testid="cloud-preview-error"
                  className="text-xs text-destructive"
                >
                  {previewError}
                </span>
                {/* 端点自己的原话（例如豆包的 55000000）：只给映射文案的话，
                    “音色与资源不匹配” 这类可行动信息就被 UI 吞掉了 */}
                {preview.errorCode && preview.error && (
                  <span
                    data-testid="cloud-preview-detail"
                    className="text-xs text-muted-foreground"
                  >
                    {preview.error}
                  </span>
                )}
              </div>
            )}
          </div>
        }
      />
      <SettingsRow
        title={t(`${KEY}.cloud.advanced`)}
        testId="cloud-advanced"
        control={
          <Button variant="ghost"
            type="button"
            data-testid="cloud-advanced-toggle"
            className="rounded-control border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent"
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            {advancedOpen
              ? t(`${KEY}.cloud.advancedHide`)
              : t(`${KEY}.cloud.advancedShow`)}
          </Button>
        }
      />
      {advancedOpen && provider.declaredTiers && (
        <SettingsRow
          sub
          title={t(`${KEY}.cloud.tierMap`)}
          testId="cloud-tier-declared"
          description={t(`${KEY}.cloud.tierDeclaredNote`)}
          control={
            <div
              className="text-xs text-muted-foreground"
              data-testid="cloud-tier-declared-text"
            >
              {TIERS.map((tone) => (
                <div key={tone}>
                  {t(`${KEY}.${TIER_LABEL[tone]}`)} →{" "}
                  <code>{provider.declaredTiers![tone]}</code>
                </div>
              ))}
            </div>
          }
        />
      )}
      {advancedOpen && !provider.declaredTiers && (
        <SettingsRow
          sub
          title={t(`${KEY}.cloud.model`)}
          testId="cloud-model"
          control={
            <div className="flex flex-col gap-2">
              <Input
                data-testid="cloud-model-input"
                className={FIELD_CLASS}
                value={cloud.models?.balanced ?? ""}
                placeholder={t(`${KEY}.cloud.modelPlaceholder`)}
                onChange={(e) => {
                  // 默认三档共用同一个模型名；要分开填就勾下面那个勾
                  const model = e.target.value;
                  patch({
                    models: { fast: model, balanced: model, best: model },
                  });
                }}
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  data-testid="cloud-split-tiers"
                  checked={splitTiers}
                  onChange={(e) => setSplitTiers(e.target.checked)}
                />
                {t(`${KEY}.cloud.splitTiers`)}
              </label>
              {splitTiers &&
                TIERS.map((tone) => (
                  <Input
                    key={tone}
                    data-testid={`cloud-model-${tone}`}
                    className={FIELD_CLASS}
                    value={cloud.models?.[tone] ?? ""}
                    placeholder={t(`${KEY}.${TIER_LABEL[tone]}`)}
                    onChange={(e) => {
                      const value = e.target.value;
                      onPatch((current) => ({
                        ...current,
                        models: { ...(current.models ?? {}), [tone]: value },
                      }));
                    }}
                  />
                ))}
            </div>
          }
        />
      )}
    </>
  );
}
