import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CODING_SUBSCRIPTIONS } from "../../../shared/coding-subscriptions";

export interface ConnectCardsProps {
  onOpenCloud: () => void;
  onOpenApiKey: () => void;
  onConnectOAuth: (providerId: string, name: string) => Promise<void>;
  onConnectSubscription: (profileKey: string, apiKey: string) => Promise<void>;
}

interface RowError {
  id: string;
  message: string;
}

/** 展示名是产品名，规范名交给 saveProvider —— 与设置页一致，不在这里改。 */
interface OAuthRow {
  id: string;
  name: string;
  labelKey: string;
  tagKey: string;
}

const OAUTH_ROWS: readonly OAuthRow[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    labelKey: "connect.rowAnthropic",
    tagKey: "connect.tagAuthorize",
  },
  {
    id: "openai-codex",
    name: "OpenAI Codex",
    labelKey: "connect.rowOpenaiCodex",
    tagKey: "connect.tagAuthorize",
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    labelKey: "connect.rowGithubCopilot",
    tagKey: "connect.tagAuthorize",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    labelKey: "connect.rowOpenRouter",
    tagKey: "connect.tagPayg",
  },
];

const CARD_CLASS =
  "flex-1 min-w-[150px] rounded-2xl border border-border-subtle bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-hover";

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * 首次进入时的三张连接卡片。只 await 注入的回调，自己不管 IPC：
 * 回调 reject 就把 message 渲染在对应的行下面。
 */
export function ConnectCards({
  onOpenCloud,
  onOpenApiKey,
  onConnectOAuth,
  onConnectSubscription,
}: ConnectCardsProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<RowError | null>(null);
  const [keyRow, setKeyRow] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState("");

  const runOAuth = async (row: OAuthRow) => {
    if (pending) return;
    setPending(row.id);
    setError(null);
    try {
      await onConnectOAuth(row.id, row.name);
    } catch (cause) {
      setError({ id: row.id, message: errorMessage(cause) });
    } finally {
      setPending(null);
    }
  };

  const runSubscription = async (profileKey: string) => {
    if (pending) return;
    const apiKey = keyDraft.trim();
    if (!apiKey) {
      setError({ id: profileKey, message: t("connect.keyRequired") });
      return;
    }
    setPending(profileKey);
    setError(null);
    try {
      await onConnectSubscription(profileKey, apiKey);
      setKeyRow(null);
      setKeyDraft("");
    } catch (cause) {
      setError({ id: profileKey, message: errorMessage(cause) });
    } finally {
      setPending(null);
    }
  };

  const rowError = (id: string) =>
    error && error.id === id ? (
      <div
        data-testid={`connect-row-error-${id}`}
        role="alert"
        className="px-2 pb-1 text-xs text-error"
      >
        {error.message}
      </div>
    ) : null;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="connect-card-cloud"
          onClick={onOpenCloud}
          className={`${CARD_CLASS} border-accent`}
        >
          <span className="block text-sm font-medium text-text-primary">
            {t("connect.cloudTitle")}
          </span>
          <span className="mt-0.5 block text-xs text-text-muted">
            {t("connect.cloudDesc")}
          </span>
        </button>
        <button
          type="button"
          data-testid="connect-card-subscription"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className={CARD_CLASS}
        >
          <span className="block text-sm font-medium text-text-primary">
            {t("connect.subscribeTitle")} {expanded ? "▴" : "▾"}
          </span>
          <span className="mt-0.5 block text-xs text-text-muted">
            {t("connect.subscribeDesc")}
          </span>
        </button>
        <button
          type="button"
          data-testid="connect-card-api-key"
          onClick={onOpenApiKey}
          className={CARD_CLASS}
        >
          <span className="block text-sm font-medium text-text-primary">
            {t("connect.apiKeyTitle")}
          </span>
          <span className="mt-0.5 block text-xs text-text-muted">
            {t("connect.apiKeyDesc")}
          </span>
        </button>
      </div>

      {expanded && (
        <div className="space-y-2">
          <div className="rounded-xl border border-border-muted p-2">
            <p className="px-2 pb-1 text-[10px] uppercase tracking-[0.1em] text-text-muted">
              {t("connect.groupOAuth")}
            </p>
            {OAUTH_ROWS.map((row) => (
              <div key={row.id}>
                <button
                  type="button"
                  data-testid={`connect-row-${row.id}`}
                  disabled={pending !== null}
                  onClick={() => void runOAuth(row)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-40"
                >
                  <span className="truncate">
                    {t(row.labelKey)}
                    {pending === row.id ? ` — ${t("connect.loggingIn")}` : ""}
                  </span>
                  <span className="ml-auto text-xs text-text-muted">
                    {t(row.tagKey)}
                  </span>
                </button>
                {rowError(row.id)}
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border-muted p-2">
            <p className="px-2 pb-1 text-[10px] uppercase tracking-[0.1em] text-text-muted">
              {t("connect.groupSubscriptionKey")}
            </p>
            {CODING_SUBSCRIPTIONS.map((plan) => (
              <div key={plan.profileKey}>
                <button
                  type="button"
                  data-testid={`connect-row-${plan.profileKey}`}
                  disabled={pending !== null}
                  aria-expanded={keyRow === plan.profileKey}
                  onClick={() =>
                    setKeyRow((current) =>
                      current === plan.profileKey ? null : plan.profileKey,
                    )
                  }
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-40"
                >
                  <span className="truncate">{plan.name}</span>
                  <span className="ml-auto text-xs text-text-muted">
                    {t("connect.tagPasteKey")}
                  </span>
                </button>
                {keyRow === plan.profileKey && (
                  <div className="flex gap-1 px-2 pb-1">
                    <input
                      data-testid={`connect-key-input-${plan.profileKey}`}
                      value={keyDraft}
                      disabled={pending !== null}
                      onChange={(event) => setKeyDraft(event.target.value)}
                      placeholder={t("connect.keyPlaceholder")}
                      className="min-w-0 flex-1 rounded-lg border border-border-subtle bg-background px-2 py-1 text-xs text-text-primary outline-none focus:border-accent"
                    />
                    <button
                      type="button"
                      data-testid={`connect-key-save-${plan.profileKey}`}
                      disabled={pending !== null}
                      onClick={() => void runSubscription(plan.profileKey)}
                      className="rounded-lg border border-accent px-2 py-1 text-xs text-accent disabled:opacity-40"
                    >
                      {t("common.save")}
                    </button>
                  </div>
                )}
                {rowError(plan.profileKey)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
