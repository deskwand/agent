import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProviderCatalogEntry } from "../settings/provider-catalog";
import { ProviderCatalogPage } from "../settings/api/provider-catalog-page";
import {
  ProviderCredentialForm,
  type ProviderCredentialValues,
} from "../settings/api/provider-credential-form";
import { Button } from "../app-button";
import type { LocalGatewayId } from "../../../shared/local-gateways";
import { FALLBACK_PROVIDER_PRESETS } from "../../hooks/useApiConfigState";

export interface ConnectPanelProps {
  /** 已经配置过的供应商 profile key（用于目录置灰） */
  configuredProfileKeys: ReadonlySet<string>;
  oauthStatuses: Record<string, { loggedIn: boolean }>;
  /** 已配过的本机网关（引导页只展示状态，不在这里配） */
  configuredLocalGateways: ReadonlySet<LocalGatewayId>;
  onOpenCloud: () => void;
  onOpenApiSettings: () => void;
  onOAuthLogin: (providerId: string, name: string) => Promise<void>;
  /** 供应商 / 订阅套餐提交凭证，由父层负责落盘 */
  onSubmitCredentials: (
    entry: ProviderCatalogEntry,
    values: ProviderCredentialValues,
  ) => Promise<void>;
}

/**
 * 首次启动的连接区：与设置页共用同一份目录与同一份凭证表单，
 * 只是只给「一步就能成」的入口，且原地展开、不开设置面板。
 */
export function ConnectPanel({
  configuredProfileKeys,
  oauthStatuses,
  configuredLocalGateways,
  onOpenCloud,
  onOpenApiSettings,
  onOAuthLogin,
  onSubmitCredentials,
}: ConnectPanelProps) {
  const { t } = useTranslation();
  const presets = FALLBACK_PROVIDER_PRESETS;
  const [pickedEntry, setPickedEntry] = useState<ProviderCatalogEntry | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const runOAuth = useCallback(
    async (providerId: string) => {
      if (pending) return;
      setPending(true);
      setError("");
      try {
        await onOAuthLogin(providerId, providerId);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setPending(false);
      }
    },
    [onOAuthLogin, pending],
  );

  const submit = async (values: ProviderCredentialValues) => {
    if (!pickedEntry) return;
    setPending(true);
    setError("");
    try {
      await onSubmitCredentials(pickedEntry, values);
      setPickedEntry(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  if (pickedEntry) {
    return (
      <div className="w-full max-w-[560px] text-left">
        <Button
          variant="ghost"
          type="button"
          data-testid="connect-back"
          onClick={() => {
            setPickedEntry(null);
            setError("");
          }}
          className="mb-3 h-auto rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-hover-surface hover:text-foreground"
        >
          ← {t("api.navBack")}
        </Button>
        <ProviderCredentialForm
          entry={pickedEntry}
          presets={presets}
          submitLabel={t("connect.connectAction")}
          busy={pending}
          errorText={error || undefined}
          onSubmit={(values) => void submit(values)}
          onCancel={() => {
            setPickedEntry(null);
            setError("");
          }}
        />
      </div>
    );
  }

  return (
    <div className="w-full max-w-[720px] text-left">
      <p className="mb-3 text-center text-sm font-medium text-foreground">
        {t("connect.cloudTitle")}
      </p>
      <ProviderCatalogPage
        compact
        presets={presets}
        configuredProfileKeys={configuredProfileKeys}
        oauthStatuses={oauthStatuses}
        oauthLoading={pending ? { "openai-codex": true } : {}}
        oauthErrors={{}}
        configuredLocalGateways={configuredLocalGateways}
        localGatewayStatus={{}}
        onBack={onOpenApiSettings}
        onPickEntry={(entry) => {
          if (entry.kind === "cloud") {
            onOpenCloud();
            return;
          }
          setPickedEntry(entry);
        }}
        onOAuthLogin={(providerId) => void runOAuth(providerId)}
        onOAuthDisconnect={() => onOpenApiSettings()}
        onOpenLocalGateway={onOpenApiSettings}
        onOpenConfigured={() => onOpenApiSettings()}
      />
      <div className="mt-3 text-center text-xs text-muted-foreground">
        {t("connect.moreHint")}{" "}
        <button
          type="button"
          data-testid="connect-more-providers"
          onClick={onOpenApiSettings}
          className="text-foreground underline underline-offset-2"
        >
          {t("connect.moreProviders")}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-center text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
