import { ChevronLeft, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProviderModelRow } from "../../../utils/merge-provider-models";
import type {
  ApiProviderConfig,
  ProviderPresets,
  ProviderProfileKey,
} from "../../../types";
import { Button } from "../../app-button";
import { Input } from "../../ui/input";
import { maskSecret } from "./provider-list-page";
import { entryForProfile, entryLabel } from "./provider-entry";
import { ProviderBrandIcon } from "../provider-icons";
import { hostOf, rowBrand } from "../configured-provider-list";
import { ProviderCredentialForm } from "./provider-credential-form";
import type { ProviderCredentialValues } from "./provider-credential-form";
import { ProviderModelList } from "./provider-model-list";

export interface ProviderDetailPageProps {
  profileKey: ProviderProfileKey;
  config: ApiProviderConfig;
  presets: ProviderPresets;
  modelRows: ProviderModelRow[];
  connectState: "idle" | "connecting" | "connected" | "failed";
  connectMessage: string;
  onBack: () => void;
  onRename: (name: string) => void;
  onSaveCredentials: (values: ProviderCredentialValues) => void;
  onTest: () => void;
  onModelsChange: (rows: ProviderModelRow[]) => void;
  onModelsCommit: (rows: ProviderModelRow[]) => void;
  onDelete: () => void;
  allowManualModels: boolean;
}

export function ProviderDetailPage({
  profileKey,
  config,
  presets,
  modelRows,
  connectState,
  connectMessage,
  onBack,
  onRename,
  onSaveCredentials,
  onTest,
  onModelsChange,
  onModelsCommit,
  onDelete,
  allowManualModels,
}: ProviderDetailPageProps) {
  const { t } = useTranslation();
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(config.name ?? "");
  const entry = entryForProfile(profileKey, config);
  const displayName =
    config.name || entryLabel(entry, presets, t) || profileKey;
  const host = hostOf(config.baseUrl) ?? entryLabel(entry, presets, t);

  const commitName = () => {
    setEditingName(false);
    const next = nameDraft.trim();
    if (next && next !== (config.name ?? "")) onRename(next);
    else setNameDraft(config.name ?? "");
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          type="button"
          data-testid="detail-back"
          onClick={onBack}
          className="inline-flex h-auto items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-hover-surface hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {t("api.navBack")}
        </Button>
      </div>

      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-muted">
          <ProviderBrandIcon
            brand={rowBrand(profileKey, config)}
            className="h-5 w-5"
          />
        </span>
        <div className="min-w-0 flex-1">
          {editingName ? (
            <Input
              data-testid="detail-name-input"
              autoFocus
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={commitName}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitName();
                if (event.key === "Escape") {
                  setNameDraft(config.name ?? "");
                  setEditingName(false);
                }
              }}
              className="h-auto w-full max-w-[260px] rounded-lg border border-border bg-background px-2 py-1 text-sm shadow-none"
            />
          ) : (
            <button
              type="button"
              data-testid="detail-name"
              onClick={() => {
                setNameDraft(config.name ?? displayName);
                setEditingName(true);
              }}
              className="block max-w-full truncate rounded-md px-1 text-left text-base font-semibold text-foreground hover:bg-hover-surface"
            >
              {displayName}
            </button>
          )}
          <p className="px-1 text-xs text-muted-foreground">{host}</p>
        </div>
        <Button
          variant="ghost"
          type="button"
          aria-label={t("api.providerRowMenu")}
          className="h-auto flex-none rounded-lg p-1.5 text-muted-foreground hover:bg-hover-surface"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </div>

      <section className="space-y-2 border-y border-border/60 py-4">
        <h4 className="text-xs font-medium text-foreground">
          {t("api.detailCredentials")}
        </h4>
        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono text-muted-foreground">
            {maskSecret(config.apiKey)}
          </span>
          <span
            className={`flex-none rounded-full px-1.5 py-0.5 ${
              connectState === "failed"
                ? "bg-destructive/10 text-destructive"
                : connectState === "connecting"
                  ? "bg-muted text-muted-foreground"
                  : "bg-success/10 text-success"
            }`}
          >
            {connectState === "failed"
              ? connectMessage || t("api.connectFailed")
              : connectState === "connecting"
                ? t("api.connecting")
                : t("api.connected")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            type="button"
            data-testid="detail-test"
            onClick={onTest}
            disabled={connectState === "connecting"}
            className="h-auto rounded-lg border border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-hover-surface hover:text-foreground disabled:opacity-50"
          >
            {t("api.detailTestHint")}
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {t("api.testConnectionOnly")}
          </span>
        </div>
      </section>

      <section className="space-y-2">
        <ProviderModelList
          rows={modelRows}
          allowManual={allowManualModels}
          onChange={onModelsChange}
          onCommit={onModelsCommit}
        />
      </section>

      <section className="space-y-2 border-t border-border/60 pt-4">
        <Button
          variant="ghost"
          type="button"
          data-testid="detail-delete"
          onClick={onDelete}
          className="h-auto rounded-lg px-1 text-xs text-destructive hover:bg-destructive/10"
        >
          {t("api.detailDanger")}
        </Button>
      </section>

      <section className="border-t border-border/60 pt-4">
        <ProviderCredentialForm
          entry={entry}
          presets={presets}
          initial={{
            name: config.name ?? "",
            apiKey: config.apiKey,
            baseUrl: config.baseUrl ?? "",
            customProtocol: config.customProtocol ?? "openai",
            maskedKey: maskSecret(config.apiKey),
          }}
          submitLabel={t("common.save")}
          busy={connectState === "connecting"}
          onSubmit={onSaveCredentials}
        />
      </section>
    </div>
  );
}
