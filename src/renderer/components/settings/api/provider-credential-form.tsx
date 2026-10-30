import { KeyRound, Loader2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { CustomProtocolType, ProviderPresets } from "../../../types";
import { Button } from "../../app-button";
import { Input } from "../../ui/input";
import { entryKeyUrl, entryLabel, entrySubtitle } from "./provider-entry";
import type { ProviderCatalogEntry } from "../provider-catalog";

export interface ProviderCredentialValues {
  name: string;
  apiKey: string;
  baseUrl: string;
  customProtocol: CustomProtocolType;
}

export interface ProviderCredentialFormProps {
  entry: ProviderCatalogEntry;
  presets: ProviderPresets;
  /** 编辑态：已有凭证回填，key 默认打码只读，点「更换」才可编辑 */
  initial?: Partial<ProviderCredentialValues> & { maskedKey?: string };
  submitLabel: string;
  busy: boolean;
  fieldError?: "apiKey" | "baseUrl";
  errorText?: string;
  onSubmit: (values: ProviderCredentialValues) => void;
  /** 本机网关等需要额外说明的场景；由调用方注入，表单只负责摆放 */
  notice?: ReactNode;
  /** 连接失败时的诊断面板；由调用方注入，表单只负责摆放 */
  diagnostics?: ReactNode;
  onCancel?: () => void;
  secondaryAction?: { label: string; onClick: () => void };
}

const ZHIPU_REGIONS: Array<{ id: string; baseUrl: string; labelKey: string }> =
  [
    {
      id: "cn",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      labelKey: "api.zhipuRegionCn",
    },
    {
      id: "global",
      baseUrl: "https://api.z.ai/api/paas/v4",
      labelKey: "api.zhipuRegionGlobal",
    },
  ];

function presetFor(
  entry: ProviderCatalogEntry,
  presets: ProviderPresets,
): { baseUrl?: string; keyPlaceholder?: string } {
  const table = presets as unknown as Record<
    string,
    { baseUrl?: string; keyPlaceholder?: string }
  >;
  return table[entry.id] ?? {};
}

/**
 * 供应商凭证表单。添加流程的第二步与详情页的凭证块共用同一个组件，
 * 差别只在 `initial` / `submitLabel` / `secondaryAction`。
 */
export function ProviderCredentialForm({
  entry,
  presets,
  initial,
  submitLabel,
  busy,
  fieldError,
  errorText,
  onSubmit,
  notice,
  diagnostics,
  onCancel,
  secondaryAction,
}: ProviderCredentialFormProps) {
  const { t } = useTranslation();
  const preset = presetFor(entry, presets);
  const isCustom = entry.kind === "provider" && entry.id === "custom";
  const isZhipu = entry.kind === "provider" && entry.id === "zhipu";

  const [name, setName] = useState(initial?.name ?? "");
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? "");
  const [baseUrl, setBaseUrl] = useState(
    initial?.baseUrl ?? preset.baseUrl ?? "",
  );
  const [protocol, setProtocol] = useState<CustomProtocolType>(
    initial?.customProtocol ?? "openai",
  );
  const [replaceKey, setReplaceKey] = useState(!initial?.maskedKey);
  const keyUrl = entryKeyUrl(entry);
  const maskedKey = initial?.maskedKey;

  const keyReady = Boolean(maskedKey) || apiKey.trim().length > 0;
  const baseUrlReady = !isCustom || baseUrl.trim().length > 0;
  const canSubmit = keyReady && baseUrlReady && !busy;

  const submit = () => {
    onSubmit({
      name: name.trim(),
      apiKey: apiKey.trim() || (initial?.apiKey ?? ""),
      baseUrl: baseUrl.trim(),
      customProtocol: protocol,
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {t("api.addTitle", { name: entryLabel(entry, presets, t) })}
          </p>
          <p className="text-xs text-muted-foreground">
            {entrySubtitle(entry, presets, t)}
          </p>
        </div>
      </div>

      {notice}

      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-foreground">
            {t("api.providerName")}
            <span className="ml-1.5 font-normal text-muted-foreground">
              {t("api.providerNamePlaceholder")}
            </span>
          </span>
          <Input
            data-testid="credential-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-auto w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-none focus-visible:ring-2 focus-visible:ring-primary/30"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-foreground">
            {t("api.apiKey")}
          </span>
          <div className="flex items-center gap-2">
            <Input
              data-testid="credential-api-key"
              type={replaceKey ? "password" : "text"}
              readOnly={!replaceKey}
              autoComplete="new-password"
              value={replaceKey ? apiKey : (maskedKey ?? "")}
              placeholder={preset.keyPlaceholder ?? t("api.enterApiKey")}
              onChange={(event) => setApiKey(event.target.value)}
              className={`h-auto min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm text-foreground shadow-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                fieldError === "apiKey" ? "border-destructive" : "border-border"
              }`}
            />
            {!replaceKey && (
              <Button
                variant="ghost"
                type="button"
                data-testid="credential-replace-key"
                onClick={() => {
                  setReplaceKey(true);
                  setApiKey("");
                }}
                className="h-auto flex-none rounded-lg border border-border/60 px-2.5 py-2 text-xs text-muted-foreground hover:bg-hover-surface hover:text-foreground"
              >
                {t("api.credentialReplaceKey")}
              </Button>
            )}
            {keyUrl && (
              <Button
                variant="ghost"
                type="button"
                data-testid="credential-key-url"
                onClick={() => void window.electronAPI?.openExternal(keyUrl)}
                className="h-auto flex-none rounded-lg px-1.5 py-2 text-xs text-primary-text hover:underline"
              >
                {t("api.getKey")} ↗
              </Button>
            )}
          </div>
          {fieldError === "apiKey" && (
            <p className="text-xs text-destructive">{t("api.enterApiKey")}</p>
          )}
        </label>

        {!isCustom && (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-foreground">
              {t("api.baseUrl")}
              <span className="ml-1.5 font-normal text-muted-foreground">
                {t("api.baseUrlPresetHint")}
              </span>
            </span>
            <Input
              data-testid="credential-base-url"
              value={baseUrl}
              readOnly
              onChange={() => undefined}
              className="h-auto w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-muted-foreground shadow-none"
            />
          </label>
        )}

        {isCustom && (
          <>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-foreground">
                {t("api.baseUrl")}
              </span>
              <Input
                data-testid="credential-base-url"
                value={baseUrl}
                placeholder={t("api.enterBaseUrl")}
                onChange={(event) => setBaseUrl(event.target.value)}
                className={`h-auto w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground shadow-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                  fieldError === "baseUrl"
                    ? "border-destructive"
                    : "border-border"
                }`}
              />
              {fieldError === "baseUrl" && (
                <p className="text-xs text-destructive">
                  {t("api.enterBaseUrl")}
                </p>
              )}
            </label>
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-foreground">
                {t("api.protocol")}
              </span>
              <div className="grid grid-cols-3 gap-2">
                {(["anthropic", "openai", "gemini"] as const).map((item) => (
                  <Button
                    variant="ghost"
                    key={item}
                    type="button"
                    onClick={() => setProtocol(item)}
                    className={`h-auto rounded-lg border px-3 py-2 text-sm transition-colors ${
                      protocol === item
                        ? "border-primary bg-primary/10 font-medium text-primary-text"
                        : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                    }`}
                  >
                    {item}
                  </Button>
                ))}
              </div>
            </div>
          </>
        )}

        {isZhipu && (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-foreground">
              {t("api.region")}
            </span>
            <div className="grid grid-cols-2 gap-2">
              {ZHIPU_REGIONS.map((region) => (
                <Button
                  variant="ghost"
                  key={region.id}
                  type="button"
                  data-testid={`credential-region-${region.id}`}
                  onClick={() => setBaseUrl(region.baseUrl)}
                  className={`h-auto rounded-lg border px-3 py-2 text-xs transition-colors ${
                    baseUrl === region.baseUrl
                      ? "border-primary bg-primary/10 font-medium text-primary-text"
                      : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                  }`}
                >
                  {t(region.labelKey)}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>

      {errorText && (
        <div
          role="alert"
          className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {errorText}
        </div>
      )}

      {diagnostics}

      <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-4">
        {onCancel && (
          <Button
            variant="ghost"
            type="button"
            data-testid="credential-cancel"
            onClick={onCancel}
            className="mr-auto h-auto rounded-lg border border-border/60 px-3 py-2 text-xs text-muted-foreground hover:bg-hover-surface hover:text-foreground"
          >
            {t("common.cancel")}
          </Button>
        )}
        {secondaryAction && (
          <Button
            variant="ghost"
            type="button"
            data-testid="credential-secondary"
            onClick={secondaryAction.onClick}
            className="h-auto rounded-lg border border-border/60 px-3 py-2 text-xs text-muted-foreground hover:bg-hover-surface hover:text-foreground"
          >
            {secondaryAction.label}
          </Button>
        )}
        <Button
          variant="ghost"
          type="button"
          data-testid="credential-submit"
          disabled={!canSubmit}
          onClick={submit}
          className="inline-flex h-auto items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("api.connecting")}
            </>
          ) : (
            <>
              <KeyRound className="h-3.5 w-3.5" />
              {submitLabel}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
