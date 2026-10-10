/**
 * SlackConfigStep — Slack bot credentials and DM policy configuration
 */

import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { Button } from "../app-button";

interface Props {
  botToken: string;
  appToken: string;
  useSocketMode: boolean;
  dmPolicy: string;
  onBotTokenChange: (value: string) => void;
  onAppTokenChange: (value: string) => void;
  onSocketModeChange: (value: boolean) => void;
  onDmPolicyChange: (value: string) => void;
}

export function SlackConfigStep({
  botToken,
  appToken,
  useSocketMode,
  dmPolicy,
  onBotTokenChange,
  onAppTokenChange,
  onSocketModeChange,
  onDmPolicyChange,
}: Props) {
  const { t } = useTranslation();

  const dmPolicies = [
    {
      value: "pairing",
      label: t("remote.policyPairing"),
      desc: t("remote.policyPairingDesc"),
    },
    {
      value: "allowlist",
      label: t("remote.policyAllowlist"),
      desc: t("remote.policyAllowlistDesc"),
    },
    {
      value: "open",
      label: t("remote.policyOpen"),
      desc: t("remote.policyOpenDesc"),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground mb-1">
          {t("remote.slackTitle")}
        </h3>
        <p className="text-sm text-muted-foreground">{t("remote.slackDesc")}</p>
      </div>

      <div className="grid gap-4">
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-2">
            {t("remote.slackBotToken")}
          </label>
          <input
            type="password"
            value={botToken}
            onChange={(e) => onBotTokenChange(e.target.value)}
            className="w-full px-4 py-3 bg-accent border border-border rounded-xl text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            placeholder="xoxb-••••••••••••"
          />
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            onClick={() => onSocketModeChange(!useSocketMode)}
            className={`relative w-10 h-6 rounded-full transition-colors ${useSocketMode ? "bg-primary hover:bg-primary/90" : "bg-border"}`}
          >
            <span
              className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${useSocketMode ? "translate-x-5" : "translate-x-1"}`}
            />
          </Button>
          <div>
            <div className="text-sm font-medium text-foreground">
              {t("remote.slackSocketMode")}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("remote.slackSocketModeDesc")}
            </div>
          </div>
        </div>

        {useSocketMode && (
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              {t("remote.slackAppToken")}
            </label>
            <input
              type="password"
              value={appToken}
              onChange={(e) => onAppTokenChange(e.target.value)}
              className="w-full px-4 py-3 bg-accent border border-border rounded-xl text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
              placeholder="xapp-••••••••••••"
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-2">
            {t("remote.dmPolicy")}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {dmPolicies.map((option) => (
              <Button
                variant="ghost"
                key={option.value}
                onClick={() => onDmPolicyChange(option.value)}
                className={`p-3 rounded-xl border-2 text-left transition-all ${
                  dmPolicy === option.value
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <div className="font-medium text-foreground text-sm">
                  {option.label}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {option.desc}
                </div>
              </Button>
            ))}
          </div>
        </div>
      </div>

      <a
        href="https://api.slack.com/apps"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 text-sm text-primary-text hover:underline"
      >
        <ExternalLink className="w-4 h-4" />
        {t("remote.openSlack")}
      </a>
    </div>
  );
}
