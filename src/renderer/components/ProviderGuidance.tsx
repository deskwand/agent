import { AlertTriangle, Info, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { Button } from "./app-button";

export interface CommonProviderSetupView {
  id: string;
  name: string;
  protocolLabel: string;
  baseUrl: string;
  exampleModel: string;
  notes: string;
  isDetected?: boolean;
}

interface GuidanceInlineHintProps {
  text?: string;
  tone?: "info" | "warning";
}

export function GuidanceInlineHint({
  text,
  tone = "info",
}: GuidanceInlineHintProps) {
  if (!text) {
    return null;
  }

  const Icon = tone === "warning" ? AlertTriangle : Info;
  const toneClass =
    tone === "warning"
      ? "border-warning/30 bg-warning/10 text-warning"
      : "border-border/40 bg-background/60 text-muted-foreground";

  return (
    <div
      className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${toneClass}`}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      <span className="leading-5">{text}</span>
    </div>
  );
}

interface CommonProviderSetupsCardProps {
  setups: CommonProviderSetupView[];
  onApplySetup: (setupId: string) => void;
}

export function CommonProviderSetupsCard({
  setups,
  onApplySetup,
}: CommonProviderSetupsCardProps) {
  const { t } = useTranslation();

  if (setups.length === 0) {
    return null;
  }

  return (
    <Collapsible className="rounded-5xl border border-border/40 bg-background/40 px-4 py-4">
      <CollapsibleTrigger asChild>
        <Button variant="ghost"
          type="button"
          className="flex w-full cursor-pointer items-center justify-between gap-3 text-sm font-medium text-foreground h-auto hover:bg-transparent hover:text-current"
        >
          <span className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary-text" />
            {t("api.guidance.commonSetupsTitle")}
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {t("api.guidance.commonSetupsHint")}
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-xs text-muted-foreground">
          <thead>
            <tr className="border-b border-border/40 text-muted-foreground">
              <th className="px-2 py-2 font-medium">
                {t("api.guidance.columns.service")}
              </th>
              <th className="px-2 py-2 font-medium">
                {t("api.guidance.columns.protocol")}
              </th>
              <th className="px-2 py-2 font-medium">
                {t("api.guidance.columns.baseUrl")}
              </th>
              <th className="px-2 py-2 font-medium">
                {t("api.guidance.columns.model")}
              </th>
              <th className="px-2 py-2 font-medium">
                {t("api.guidance.columns.notes")}
              </th>
              <th className="px-2 py-2 font-medium text-right">
                {t("api.guidance.columns.action")}
              </th>
            </tr>
          </thead>
          <tbody>
            {setups.map((setup) => (
              <tr
                key={setup.id}
                className={
                  setup.isDetected
                    ? "bg-primary/5 text-foreground"
                    : "text-muted-foreground"
                }
              >
                <td className="px-2 py-3 font-medium">
                  <div className="flex items-center gap-2">
                    <span>{setup.name}</span>
                    {setup.isDetected && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs uppercase tracking-[0.08em] text-primary-text">
                        {t("api.guidance.detectedBadge")}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-2 py-3">{setup.protocolLabel}</td>
                <td className="px-2 py-3 font-mono text-xs text-muted-foreground">
                  {setup.baseUrl}
                </td>
                <td className="px-2 py-3 font-mono text-xs text-muted-foreground">
                  {setup.exampleModel}
                </td>
                <td className="px-2 py-3 leading-5">{setup.notes}</td>
                <td className="px-2 py-3 text-right">
                  <Button variant="ghost"
                    type="button"
                    onClick={() => onApplySetup(setup.id)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent h-auto"
                  >
                    {t("api.guidance.apply")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CollapsibleContent>
    </Collapsible>
  );
}
