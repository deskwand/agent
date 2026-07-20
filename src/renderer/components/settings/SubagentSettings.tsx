import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import type {
  AppConfig,
  SubagentDefaultModel,
  ApiProviderConfig,
} from "../../types";

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

export function SubagentSettings() {
  const { t } = useTranslation();
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editingAgent, setEditingAgent] = useState<string | null>(null);
  const [editingModel, setEditingModel] = useState("inherit");
  const [editingProvider, setEditingProvider] = useState("");
  const [editingModelId, setEditingModelId] = useState("");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [showNewModal, setShowNewModal] = useState(false);
  const [deletingAgent, setDeletingAgent] = useState<string | null>(null);

  const [defaultModel, setDefaultModel] = useState<SubagentDefaultModel>({
    mode: "inherit",
  });
  const [provider, setProvider] = useState("");
  const [modelId, setModelId] = useState("");

  useEffect(() => {
    (async () => {
      const config = await window.electronAPI.config.get();
      setAppConfig(config);
      const dm = config.subagent?.defaultModel ?? { mode: "inherit" };
      setDefaultModel(dm as SubagentDefaultModel);
      if (dm.mode === "model") {
        setProvider(dm.providerProfileKey);
        setModelId(dm.modelId);
      }
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

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const nextDM: SubagentDefaultModel =
        defaultModel.mode === "model"
          ? { mode: "model", providerProfileKey: provider, modelId }
          : { mode: "inherit" };
      await window.electronAPI.config.save({
        subagent: { defaultModel: nextDM },
      } as Partial<AppConfig>);
      setDefaultModel(nextDM);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }, [defaultModel, provider, modelId]);

  const providerKeys = Object.keys(appConfig?.providers ?? {});

  return (
    <div className="px-2 py-1 space-y-4">
      <div className="flex items-center gap-3">
        <select
          className="flex-1 rounded-lg border border-border-muted bg-background px-3 py-2 text-sm text-text-primary"
          value={defaultModel.mode}
          onChange={(e) => {
            const mode = e.target.value as SubagentDefaultModel["mode"];
            if (mode === "inherit") {
              setDefaultModel({ mode: "inherit" });
            } else {
              setDefaultModel({ mode: "model", providerProfileKey: provider, modelId });
            }
          }}
        >
          <option value="inherit">{t("subagent.inheritMain")}</option>
          <option value="model">{t("subagent.modelSeg")}</option>
        </select>

        {defaultModel.mode === "model" && (
          <>
            <select
              className="flex-1 rounded-lg border border-border-muted bg-background px-3 py-2 text-sm text-text-primary"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              <option value="">{t("subagent.selectProvider")}</option>
              {providerKeys.map((k) => (
                <option key={k} value={k}>{appConfig?.providers[k]?.name || k}</option>
              ))}
            </select>
            <select
              className="flex-1 rounded-lg border border-border-muted bg-background px-3 py-2 text-sm text-text-primary"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
            >
              <option value="">{t("subagent.selectModel")}</option>
              {(appConfig?.providers[provider] as ApiProviderConfig | undefined)?.models.map((m) => (
                <option key={m.id} value={m.id}>{m.label || m.id}</option>
              ))}
            </select>
          </>
        )}

        <button
          type="button"
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          disabled={saving}
          onClick={handleSave}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
          {t("common.save")}
        </button>

        {saved && (
          <div className="flex items-center gap-2 rounded-lg bg-success/10 px-4 py-3 text-sm text-success">
            <CheckCircle className="h-4 w-4" />
            {t("common.saved")}
          </div>
        )}
      </div>

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
              <span className="text-xs text-text-muted bg-muted px-1.5 py-0.5 rounded">
                {agent.source === "builtin"
                  ? t("subagent.sourceBuiltin")
                  : agent.source === "project"
                    ? t("subagent.sourceProject")
                    : t("subagent.sourceGlobal")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted">
                {agent.markdownModel ? agent.markdownModel : t("subagent.followGlobal")}
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
              <option value="model">{t("subagent.modelSeg")}</option>
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
