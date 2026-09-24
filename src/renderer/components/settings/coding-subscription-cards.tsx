import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CODING_SUBSCRIPTIONS,
  type CodingSubscription,
} from "../../../shared/coding-subscriptions";

type Profiles = Partial<Record<string, { apiKey: string }>>;

interface Props {
  profiles: Profiles;
  onSave: (profileKey: string, apiKey: string) => Promise<void>;
  onDelete: (profileKey: string) => Promise<void>;
}

function SubscriptionCard({
  plan,
  configured,
  onSave,
  onDelete,
}: {
  plan: CodingSubscription;
  configured: boolean;
  onSave: Props["onSave"];
  onDelete: Props["onDelete"];
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!key.trim()) {
      setError(t("api.enterApiKey"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(plan.profileKey, key.trim());
      setKey("");
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      await onDelete(plan.profileKey);
      setConfirming(false);
      setEditing(false);
      setKey("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid={`${plan.profileKey}-card`}
      className="rounded-xl border border-border-muted bg-surface px-4 py-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-text-primary">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-5 w-5 shrink-0 fill-none stroke-current text-text-secondary"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {plan.profileKey === "custom:subscription-bailian-coding" ? (
                <path d="M6.3 18h10.5a4 4 0 0 0 .2-8 6 6 0 0 0-11.2-.7A4.5 4.5 0 0 0 6.3 18Z" />
              ) : plan.profileKey === "custom:subscription-ark-coding" ? (
                <>
                  <path d="M3 19h18l-5.2-8h-7.6L3 19Z" />
                  <path d="m9 11 3-6 3 6" />
                </>
              ) : null}
            </svg>
            <span className="truncate">{plan.name}</span>
          </div>
          <div className="text-xs text-text-muted">
            {configured ? t("api.subscriptionConfigured") : t(plan.noteKey)}
          </div>
        </div>
        <button
          type="button"
          data-action="configure"
          onClick={() => {
            setEditing(!editing);
            setConfirming(false);
            setError("");
            setKey("");
          }}
          className="rounded-lg border border-border-muted px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-hover"
        >
          {t(
            configured
              ? "api.subscriptionEditKey"
              : "api.subscriptionConfigureKey",
          )}
        </button>
      </div>
      {configured && (
        <div className="mt-1 text-xs text-warning">{t(plan.noteKey)}</div>
      )}
      <div className="mt-1 text-xs text-text-muted">
        <a
          href={plan.keyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          {t("api.subscriptionGetKey")}
        </a>
        {" · "}
        <a
          href={plan.termsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
        >
          {t("api.subscriptionTerms")}
        </a>
      </div>
      {editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="password"
            autoComplete="new-password"
            autoCorrect="off"
            spellCheck={false}
            aria-label={t("api.subscriptionConfigureKey")}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-border-muted bg-surface px-2 py-1.5 text-sm text-text-primary"
          />
          <button
            type="button"
            data-action="save"
            disabled={busy}
            onClick={() => void save()}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs text-accent-foreground disabled:opacity-50"
          >
            {t("common.save")}
          </button>
        </div>
      )}
      {configured && (
        <div className="mt-2">
          {confirming ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-warning">
                {t("api.subscriptionDisconnectConfirm")}
              </span>
              <button
                type="button"
                data-action="confirm-remove"
                disabled={busy}
                onClick={() => void remove()}
                className="text-xs text-error"
              >
                {t("api.subscriptionDisconnect")}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-xs text-text-secondary"
              >
                {t("common.cancel")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              data-action="remove"
              onClick={() => {
                setConfirming(true);
                setEditing(false);
              }}
              className="text-xs text-text-secondary hover:text-error"
            >
              {t("api.subscriptionDisconnect")}
            </button>
          )}
        </div>
      )}
      {error && (
        <div role="alert" className="mt-2 text-xs text-error">
          {error}
        </div>
      )}
    </div>
  );
}

export function CodingSubscriptionCards({ profiles, onSave, onDelete }: Props) {
  return (
    <div className="space-y-2">
      {CODING_SUBSCRIPTIONS.map((plan) => (
        <SubscriptionCard
          key={plan.profileKey}
          plan={plan}
          configured={Boolean(profiles[plan.profileKey]?.apiKey?.trim())}
          onSave={onSave}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
