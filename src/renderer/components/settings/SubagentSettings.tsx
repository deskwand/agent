import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { AppConfig, ApiProviderConfig } from "../../types";
import { modelDisplay } from "../../utils/subagent-model-display";
import { resolveProviderDisplayName } from "../../utils/model-label";
import { DESKWAND_PROVIDER_PREFIX } from "../../../shared/deskwand-provider";
import { Tooltip, TooltipContent, TooltipTrigger } from "../app-tooltip";
import { SettingsFormSelect } from "./shared";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Button } from "../app-button";

const NAME_I18N_MAP: Record<string, string> = {
  Explore: "subagent.agentExplore",
  "general-purpose": "subagent.agentFixer",
  Plan: "subagent.agentPlanner",
  Review: "subagent.agentReviewer",
};

function displayName(name: string, t: (key: string) => string): string {
  return NAME_I18N_MAP[name] ? t(NAME_I18N_MAP[name]) : name;
}

interface AgentRow {
  name: string;
  displayName: string;
  source: "builtin" | "global" | "project";
  markdownModel?: string;
  markdownThinking?: string;
}

export function SubagentSettings() {
  const { t } = useTranslation();
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [editingAgent, setEditingAgent] = useState<string | null>(null);
  const [editingModel, setEditingModel] = useState("inherit");
  const [editingThinking, setEditingThinking] = useState("inherit");
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
      } catch {
        /* */
      }
    })();
  }, []);

  const providerKeys = Object.keys(appConfig?.providers ?? {});

  return (
    <div className="px-2 py-1 space-y-4">
      {/* Agent 列表 */}
      <div>
        <p className="text-xs text-muted-foreground mb-2">
          {t("subagent.agentList")}
        </p>
        {agents.map((agent) => (
          <div
            key={agent.name}
            className="flex items-center justify-between py-2.5 border-b border-border/60 last:border-0"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {displayName(agent.name, t)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {!agent.markdownModel || agent.markdownModel === "inherit"
                  ? t("subagent.inheritMain")
                  : modelDisplay(
                      agent.markdownModel,
                      appConfig?.providers ?? {},
                      t,
                    )}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    type="button"
                    className="p-1 rounded hover:bg-hover-surface h-auto"
                    aria-label={t("subagent.editModel") ?? "Edit model"}
                    onClick={() => {
                      setEditingAgent(agent.name);
                      const hasModel =
                        agent.markdownModel &&
                        agent.markdownModel !== "inherit";
                      setEditingModel(hasModel ? "model" : "inherit");
                      if (hasModel && agent.markdownModel) {
                        const slashIdx = agent.markdownModel.indexOf("/");
                        let provider =
                          slashIdx > 0
                            ? agent.markdownModel.slice(0, slashIdx)
                            : "";
                        if (provider.startsWith(DESKWAND_PROVIDER_PREFIX)) {
                          provider = provider.slice(
                            DESKWAND_PROVIDER_PREFIX.length,
                          );
                        }
                        setEditingProvider(provider);
                        setEditingModelId(
                          slashIdx > 0
                            ? agent.markdownModel.slice(slashIdx + 1)
                            : "",
                        );
                      }
                      setEditingThinking(agent.markdownThinking || "inherit");
                    }}
                  >
                    <Pencil size={14} />
                  </Button>
                </TooltipTrigger>
                {/* side 必须显式给 bottom：Radix 的 TooltipContent 默认是 top，
                    而老 Tooltip 的 placement 默认是下方。 */}
                <TooltipContent side="bottom">
                  {t("subagent.editModel") ?? "Edit model"}
                </TooltipContent>
              </Tooltip>
              {agent.source !== "builtin" &&
                (deletingAgent === agent.name ? (
                  <Button
                    variant="ghost"
                    type="button"
                    className="px-2 py-1 rounded text-xs text-red-500 hover:bg-red-500/10 h-auto"
                    onClick={async () => {
                      await window.electronAPI.subagent.deleteAgent(agent.name);
                      setDeletingAgent(null);
                      const list =
                        await window.electronAPI.subagent.listAgents();
                      if (Array.isArray(list)) setAgents(list as AgentRow[]);
                    }}
                  >
                    {t("subagent.confirmDelete")}
                  </Button>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        type="button"
                        aria-label={t("common.delete")}
                        className="p-1 rounded hover:bg-hover-surface text-muted-foreground hover:text-red-500 h-auto"
                        onClick={() => setDeletingAgent(agent.name)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {t("common.delete")}
                    </TooltipContent>
                  </Tooltip>
                ))}
            </div>
          </div>
        ))}

        {/* 编辑模型弹窗 */}
        {editingAgent && (
          <div className="mt-3 p-4 border border-border/60 rounded-lg space-y-3">
            <p className="text-sm font-medium">
              {editingAgent} {t("subagent.editModel")}
            </p>

            <div>
              <p className="text-xs text-muted-foreground mb-1">
                {t("subagent.modelLabel")}
              </p>
              <SettingsFormSelect
                value={editingModel}
                onChange={setEditingModel}
                label={t("subagent.modelLabel")}
                testId="subagent-model-mode"
                options={[
                  { value: "inherit", label: t("subagent.inheritMain") },
                  { value: "model", label: t("subagent.customModel") },
                ]}
              />
            </div>

            {editingModel === "model" && (
              <>
                <div className="flex gap-2">
                  <SettingsFormSelect
                    value={editingProvider}
                    onChange={setEditingProvider}
                    label={t("subagent.selectProvider")}
                    testId="subagent-provider"
                    triggerClassName="flex-1"
                    options={[
                      { value: "", label: t("subagent.selectProvider") },
                      ...providerKeys.map((k) => ({
                        value: k,
                        label:
                          resolveProviderDisplayName(
                            k,
                            appConfig?.providers[k]?.name,
                            t,
                          ) || k,
                      })),
                    ]}
                  />
                  <SettingsFormSelect
                    value={editingModelId}
                    onChange={setEditingModelId}
                    label={t("subagent.selectModel")}
                    testId="subagent-model-id"
                    triggerClassName="flex-1"
                    options={[
                      { value: "", label: t("subagent.selectModel") },
                      ...((
                        appConfig?.providers[editingProvider] as
                          | ApiProviderConfig
                          | undefined
                      )?.models.map((m) => ({
                        value: m.id,
                        label: m.label || m.id,
                      })) ?? []),
                    ]}
                  />
                </div>

                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    {t("subagent.thinkingLabel")}
                  </p>
                  <SettingsFormSelect
                    value={editingThinking}
                    onChange={setEditingThinking}
                    label={t("subagent.thinkingLabel")}
                    testId="subagent-thinking"
                    options={[
                      { value: "inherit", label: t("subagent.inheritMain") },
                      ...["off", "low", "medium", "high", "max"].map(
                        (level) => ({ value: level, label: level }),
                      ),
                    ]}
                  />
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                className="rounded-lg border px-3 py-1.5 text-sm h-auto hover:bg-transparent hover:text-current"
                onClick={() => setEditingAgent(null)}
              >
                {t("common.cancel") ?? "取消"}
              </Button>
              <Button
                variant="ghost"
                className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
                onClick={async () => {
                  const model =
                    editingModel === "model"
                      ? `${editingProvider}/${editingModelId}`
                      : "inherit";
                  const thinking =
                    editingThinking === "inherit" ? undefined : editingThinking;
                  await window.electronAPI.subagent.setAgentModel(
                    editingAgent,
                    model,
                    thinking,
                  );
                  setEditingAgent(null);
                  const list = await window.electronAPI.subagent.listAgents();
                  if (Array.isArray(list)) setAgents(list as AgentRow[]);
                }}
              >
                {t("common.save")}
              </Button>
              <Button
                variant="ghost"
                className="rounded-lg border px-3 py-1.5 text-sm h-auto hover:bg-transparent hover:text-current"
                onClick={() => setEditingAgent(null)}
              >
                {t("common.cancel") ?? "取消"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 新增 Agent */}
      <Button
        variant="ghost"
        type="button"
        size="xs"
        // ⚠️ `text-sm` 是**有意**的：`xs` 档自带 `text-xs`，而这行要保留原本的 14px 字号 ——
        // 调用点排在最后、`cn` 合并后只剩 `text-sm` ✓（档位只管几何，字号由调用点定 ✓）。
        className="flex items-center text-sm text-muted-foreground hover:text-muted-foreground"
        onClick={() => setShowNewModal(true)}
      >
        <Plus size={14} />
        {t("subagent.addAgent")}
      </Button>

      {/* 新增 Agent 弹窗 */}
      {showNewModal && (
        <div className="mt-3 p-3 border border-border/60 rounded-lg space-y-2">
          <p className="text-sm font-medium">{t("subagent.addAgentTitle")}</p>
          <Input
            className="h-auto w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm text-foreground shadow-none"
            placeholder={t("subagent.agentName")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Input
            className="h-auto w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm text-foreground shadow-none"
            placeholder={t("subagent.agentDescription")}
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
          />
          <Textarea
            className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm text-foreground shadow-none"
            rows={4}
            placeholder={t("subagent.agentPrompt")}
            value={newPrompt}
            onChange={(e) => setNewPrompt(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground h-auto hover:bg-transparent hover:text-current"
              onClick={async () => {
                if (!newName.trim()) return;
                await window.electronAPI.subagent.createAgent(
                  newName.trim(),
                  newDesc.trim(),
                  newPrompt.trim(),
                );
                setShowNewModal(false);
                setNewName("");
                setNewDesc("");
                setNewPrompt("");
                const list = await window.electronAPI.subagent.listAgents();
                if (Array.isArray(list)) setAgents(list as AgentRow[]);
              }}
            >
              {t("common.save")}
            </Button>
            <Button
              variant="ghost"
              className="rounded-lg border px-3 py-1.5 text-sm h-auto hover:bg-transparent hover:text-current"
              onClick={() => setShowNewModal(false)}
            >
              {t("common.cancel") ?? "取消"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
