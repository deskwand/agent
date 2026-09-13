import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Bot, Loader2 } from "lucide-react";

interface AgentRunContainerProps {
  agentType: string;
  status: string;
  toolUses?: number;
  turnCount?: number;
  tokens?: { input: number; output: number; total: number };
  durationMs?: number;
  modelName?: string;
  children: React.ReactNode;
}

function statusColor(status: string): string {
  switch (status) {
    case "completed":
      return "text-green-500";
    case "error":
    case "aborted":
      return "text-red-500";
    case "running":
    case "steered":
      return "text-blue-500";
    default:
      return "text-muted-foreground";
  }
}

export function AgentRunContainer({
  agentType,
  status,
  toolUses,
  turnCount,
  tokens,
  durationMs,
  modelName,
  children,
}: AgentRunContainerProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(status !== "running");

  const totalTokens = tokens?.total;
  const durationSec = durationMs ? (durationMs / 1000).toFixed(1) : undefined;

  return (
    <div className="border rounded-lg my-2 bg-muted/30">
      {/* 标题栏 */}
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 rounded-t-lg"
        onClick={() => setCollapsed((v) => !v)}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <Bot size={14} />
        <span className="font-medium">{agentType}</span>
        {modelName && (
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {modelName}
          </span>
        )}
        <span className={`text-xs ml-auto ${statusColor(status)}`}>
          {t(`chat.agentRun.status.${status}`, { defaultValue: status })}
        </span>
        {status === "running" && (
          <Loader2 size={12} className="animate-spin text-blue-500" />
        )}
      </button>

      {/* 统计摘要 */}
      <div className="px-3 pb-1 flex gap-3 text-xs text-muted-foreground">
        {toolUses !== undefined && (
          <span>{t("chat.agentRun.toolUses", { count: toolUses })}</span>
        )}
        {turnCount !== undefined && (
          <span>{t("chat.agentRun.turns", { count: turnCount })}</span>
        )}
        {totalTokens !== undefined && (
          <span>Tokens: {totalTokens.toLocaleString()}</span>
        )}
        {durationSec && <span>{durationSec}s</span>}
      </div>

      {/* 嵌套内容 */}
      {!collapsed && <div className="px-2 pb-2 space-y-1">{children}</div>}
    </div>
  );
}
