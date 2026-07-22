import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { AppConfig, ApiProviderConfig } from "../../types";

const NAME_I18N_MAP: Record<string, string> = {
  Explore: "subagent.agentExplore",
  "general-purpose": "subagent.agentFixer",
  Plan: "subagent.agentPlanner",
};

function displayName(name: string, t: (key: string) => string): string {
  return NAME_I18N_MAP[name] ? t(NAME_I18N_MAP[name]) : name;
}

interface AgentRow {
  name: string;
  displayName: string;
  source: "builtin" | "global" | "project";
  markdownModel?: string;
}

function modelDisplay(raw: string, providers: Record<string, any>): string {
  const slashIdx = raw.indexOf("/");
  if (slashIdx === -1) return raw;
  const providerKey = raw.slice(0, slashIdx);
  const modelId = raw.slice(slashIdx + 1);
  const provider = providers[providerKey];
  const providerName = provider?.name || providerKey;
  const modelLabel = provider?.models?.find((m: any) => m.id === modelId)?.label || modelId;
  return `${providerName} / ${modelLabel}`;
}

export function SubagentSettings() {
  const { t } = useTranslation();
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [editingAgent, setEditingAgent] = useState<string | null>(null);
  const [editingModel, setEditingModel] = useState("inherit");
  const [editingProvider, setEditingProvider] = useState("");
  const [editingModelId, setEditingModelId] = useState("");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [showNewModal, setShowNewModal] = useState(false);
  const [deletingAgent, setDeletingAgent] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const config = await window.electronAPI.config.get();
      setAppConfig(config);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const list = await window.electronAPI.subagent.listAgents();
        if (Array.isArray(list)) setAgents(list as AgentRow[]);
      } catch { /* */ }
    })();
  }, []);

  const providerKeys = Object.keys(appConfig?.providers ?? {});

  return (
    <div className="px-2 py-1 space-y-4">
      {/* Agent 列表 */}
      <div>
        <p className="text-xs text-text-muted mb-2">{t("subagent.agentList")}</p>
        {agents.map((agent) => (
          <div
            key={agent.name}
            className="flex items-center justify-between py-2.5 border-b border-border-muted last:border-0"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {displayName(agent.name, t)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted">
                {!agent.markdownModel || agent.markdownModel === "inherit"
                  ? t("subagent.inheritMain")
                  : modelDisplay(agent.markdownModel, appConfig?.providers ?? {})}
              </span>
              <button
                type="button"
                className="p-1 rounded hover:bg-muted"
                title={t("subagent.editModel") ?? "Edit model"}
                onClick={() => {
                  setEditingAgent(agent.name);
                  setEditingModel(agent.markdownModel ? "model" : "inherit");
                }}
              >
                <Pencil size={14} />
              </button>
              {agent.source !== "builtin" && (
                deletingAgent === agent.name ? (
                  <button
                    type="button"
                    className="px-2 py-1 rounded text-xs text-red-500 hover:bg-red-500/10"
                    onClick={async () => {
                      await window.electronAPI.subagent.deleteAgent(agent.name);
                      setDeletingAgent(null);
                      const list = await window.electronAPI.subagent.listAgents();
                      if (Array.isArray(list)) setAgents(list as AgentRow[]);
                    }}
                  >
                    {t("subagent.confirmDelete")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="p-1 rounded hover:bg-muted text-text-muted hover:text-red-500"
                    title="Delete"
                    onClick={() => setDeletingAgent(agent.name)}
                  >
                    <Trash2 size={14} />
                  </button>
                )
              )}
            </div>
          </div>
        ))}

        {/* 编辑模型弹窗 */}
        {editingAgent && (
          <div className="mt-3 p-3 border border-border-muted rounded-lg space-y-2">
            <p className="text-sm font-medium">{editingAgent} {t("subagent.editModel")}</p>
            <select className="w-full rounded-lg border border-border-muted bg-background px-3 py-2 text-sm text-text-primary" value={editingModel} onChange={(e) => setEditingModel(e.target.value)}>
              <option value="inherit">{t("subagent.inheritMain")}</option>
              <option value="model">{t("subagent.customModel")}</option>
            </select>
            {editingModel === "model" && (
              <div className="flex gap-2">
                <select className="flex-1 rounded-lg border border-border-muted bg-background px-3 py-2 text-sm text-text-primary" value={editingProvider} onChange={(e) => setEditingProvider(e.target.value)}>
                  <option value="">{t("subagent.selectProvider")}</option>
                  {providerKeys.map((k) => (<option key={k} value={k}>{appConfig?.providers[k]?.name || k}</option>))}
                </select>
                <select className="flex-1 rounded-lg border border-border-muted bg-background px-3 py-2 text-sm text-text-primary" value={editingModelId} onChange={(e) => setEditingModelId(e.target.value)}>
                  <option value="">{t("subagent.selectModel")}</option>
                  {(appConfig?.providers[editingProvider] as ApiProviderConfig | undefined)?.models.map((m) => (<option key={m.id} value={m.id}>{m.label || m.id}</option>))}
                </select>
              </div>
            )}
            <div className="flex gap-2">
              <button className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground" onClick={async () => {
                const model = editingModel === "model" ? `${editingProvider}/${editingModelId}` : "inherit";
                await window.electronAPI.subagent.setAgentModel(editingAgent, model);
                setEditingAgent(null);
                const list = await window.electronAPI.subagent.listAgents();
                if (Array.isArray(list)) setAgents(list as AgentRow[]);
              }}>{t("common.save")}</button>
              <button className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => setEditingAgent(null)}>{t("common.cancel") ?? "取消"}</button>
            </div>
          </div>
        )}
      </div>

      {/* 新增 Agent */}
      <button
        type="button"
        className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-secondary"
        onClick={() => setShowNewModal(true)}
      >
        <Plus size={14} />
        {t("subagent.addAgent")}
      </button>

      {/* 新增 Agent 弹窗 */}
      {showNewModal && (
        <div className="mt-3 p-3 border border-border-muted rounded-lg space-y-2">
          <p className="text-sm font-medium">{t("subagent.addAgentTitle")}</p>
          <input className="w-full rounded-lg border border-border-muted bg-background px-3 py-2 text-sm text-text-primary" placeholder={t("subagent.agentName")} value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input className="w-full rounded-lg border border-border-muted bg-background px-3 py-2 text-sm text-text-primary" placeholder={t("subagent.agentDescription")} value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
          <textarea className="w-full rounded-lg border border-border-muted bg-background px-3 py-2 text-sm text-text-primary" rows={4} placeholder={t("subagent.agentPrompt")} value={newPrompt} onChange={(e) => setNewPrompt(e.target.value)} />
          <div className="flex gap-2">
            <button className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground" onClick={async () => {
              if (!newName.trim()) return;
              await window.electronAPI.subagent.createAgent(newName.trim(), newDesc.trim(), newPrompt.trim());
              setShowNewModal(false);
              setNewName(""); setNewDesc(""); setNewPrompt("");
              const list = await window.electronAPI.subagent.listAgents();
              if (Array.isArray(list)) setAgents(list as AgentRow[]);
            }}>{t("common.save")}</button>
            <button className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => setShowNewModal(false)}>{t("common.cancel") ?? "取消"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
