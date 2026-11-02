import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Folder, Shuffle, X } from "lucide-react";
import {
  DEFAULT_AGENT_HEARTBEAT,
  type PersistentAgentView,
} from "../../../shared/persistent-agent";
import {
  ALL_RISKY_DISABLED,
  RISKY_CAPABILITIES,
  type RiskyCapabilities,
} from "../../../shared/agent-risky-capabilities";
import { useAppStore } from "../../store";
import { usePersistentAgentStore } from "../../store/persistent-agents";
import type { ClientEvent } from "../../types";
import { Button } from "../app-button";
import { PartnerAvatar } from "./PartnerAvatar";
import { OccludingDialog } from "../ui/occluding-dialog";
import { DialogClose, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

interface AgentEditModalProps {
  /** 不传 = 新建。 */
  agent?: PersistentAgentView;
  onClose: () => void;
}

const FIELD_LABEL = "text-xs font-medium text-muted-foreground";

export function AgentEditModal({ agent, onClose }: AgentEditModalProps) {
  const { t } = useTranslation();
  const removeSession = useAppStore((s) => s.removeSession);
  const upsert = usePersistentAgentStore((s) => s.upsert);
  const [name, setName] = useState(agent?.name ?? "");
  const [avatarSeed, setAvatarSeed] = useState(
    () => agent?.avatarSeed ?? crypto.randomUUID(),
  );
  const [instructions, setInstructions] = useState(agent?.instructions ?? "");
  const [cwd, setCwd] = useState(agent?.cwd ?? "");
  const [risky, setRisky] = useState<RiskyCapabilities>(
    agent?.riskyCapabilities ?? ALL_RISKY_DISABLED,
  );
  const [trusted, setTrusted] = useState<string[]>(
    agent?.trustedRecipients ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteSession, setDeleteSession] = useState(false);

  const pickFolder = async () => {
    const event: ClientEvent = { type: "folder.select", payload: {} };
    const picked = await window.electronAPI.invoke<string | null>(event);
    if (picked) setCwd(picked);
  };

  const save = async () => {
    if (!name.trim() || !instructions.trim()) {
      setError(t("persistentAgents.form.required"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = agent
        ? await window.electronAPI.persistentAgents.update(agent.id, {
            name,
            instructions,
            avatarSeed,
            riskyCapabilities: risky,
            // 唤醒节奏不再由用户设置：interval 就是内置心跳，保存时顺手归一到
            // 30 分钟，免得老伙伴早先选的 5 分钟继续偷偷烧额度；daily / weekly
            // 是用户当初定下的固定时刻，原样留在库里，不下发。
            ...(agent.schedule.kind === "interval"
              ? { schedule: DEFAULT_AGENT_HEARTBEAT }
              : {}),
            // Only when something was removed: an approval granted while this
            // modal was open must not be overwritten by the opening snapshot.
            ...(trusted.length < (agent.trustedRecipients?.length ?? 0)
              ? { trustedRecipients: trusted }
              : {}),
          })
        : await window.electronAPI.persistentAgents.create({
            name,
            instructions,
            ...(cwd ? { cwd } : {}),
            schedule: DEFAULT_AGENT_HEARTBEAT,
            wakeImmediately: true,
            avatarSeed,
            riskyCapabilities: risky,
          });
      if (saved) upsert(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!agent) return;
    setSaving(true);
    try {
      await window.electronAPI.persistentAgents.delete(agent.id, {
        deleteSession,
      });
      if (deleteSession) removeSession(agent.sessionId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <OccludingDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="w-[calc(100%-2rem)] max-w-lg max-h-[85vh] overflow-y-auto bg-card rounded-xl sm:rounded-xl shadow-xl border border-border p-0 gap-0 [&>button]:hidden"
        aria-describedby={undefined}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
          <DialogTitle className="text-sm font-semibold text-foreground">
            {agent
              ? t("persistentAgents.form.editTitle")
              : t("persistentAgents.form.createTitle")}
          </DialogTitle>
          <DialogClose asChild>
            <Button
              variant="ghost"
              type="button"
              aria-label={t("common.close")}
              className="p-1 rounded-md hover:bg-hover-surface text-muted-foreground transition-colors h-auto"
            >
              <X size={16} />
            </Button>
          </DialogClose>
        </div>

        {confirmDelete ? (
          <div className="px-5 py-6 space-y-3">
            <p className="text-sm font-medium text-foreground">
              {t("persistentAgents.delete.title", { name: agent?.name })}
            </p>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={deleteSession}
                onChange={(e) => setDeleteSession(e.target.checked)}
              />
              {t("persistentAgents.delete.alsoSession")}
            </label>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            <div className="flex items-center gap-3" data-avatar-preview>
              <PartnerAvatar seed={avatarSeed} size={48} />
              <Button
                variant="ghost"
                type="button"
                onClick={() => setAvatarSeed(crypto.randomUUID())}
                className="h-auto gap-1.5 px-2 py-1 text-xs text-muted-foreground"
              >
                <Shuffle className="h-3.5 w-3.5" />
                {t("persistentAgents.form.shuffleAvatar")}
              </Button>
            </div>
            <div className="space-y-1">
              <label className={FIELD_LABEL} htmlFor="agent-name">
                {t("persistentAgents.form.name")}
              </label>
              <Input
                id="agent-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className={FIELD_LABEL} htmlFor="agent-instructions">
                {t("persistentAgents.form.instructions")}
              </label>
              <Textarea
                id="agent-instructions"
                rows={5}
                value={instructions}
                placeholder={t("persistentAgents.form.instructionsPlaceholder")}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <span className={FIELD_LABEL}>
                {t("persistentAgents.form.workspace")}
              </span>
              <div className="flex items-center gap-2">
                <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-border px-3 text-xs text-foreground">
                  <Folder className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    {cwd || t("persistentAgents.form.autoWorkspace")}
                  </span>
                </div>
                {/* 工作目录绑定在会话上，建好后不能改 */}
                {!agent && (
                  <>
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() => void pickFolder()}
                      className="text-xs h-9"
                    >
                      {t("persistentAgents.form.pickWorkspace")}
                    </Button>
                    {cwd && (
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={() => setCwd("")}
                        className="text-xs h-9 px-2 text-muted-foreground"
                      >
                        {t("persistentAgents.form.resetWorkspace")}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <span className={FIELD_LABEL}>
                {t("persistentAgents.form.riskyTitle")}
              </span>
              <p className="text-xs text-muted-foreground">
                {t("persistentAgents.form.riskyHint")}
              </p>
              {RISKY_CAPABILITIES.map((cap) => (
                <label key={cap} className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    data-risky={cap}
                    className="mt-0.5"
                    checked={risky[cap]}
                    onChange={(e) =>
                      setRisky((prev) => ({ ...prev, [cap]: e.target.checked }))
                    }
                  />
                  <span>
                    <span className="block text-foreground">
                      {t(`persistentAgents.form.risky.${cap}`)}
                    </span>
                    <span className="block text-muted-foreground">
                      {t(`persistentAgents.form.risky.${cap}Desc`)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {agent && trusted.length > 0 && (
              <div className="space-y-2">
                <span className={FIELD_LABEL}>
                  {t("persistentAgents.form.trustedTitle")}
                </span>
                <ul className="space-y-1">
                  {trusted.map((recipient) => (
                    <li
                      key={recipient}
                      className="flex items-center justify-between gap-2 text-xs text-foreground"
                    >
                      <span className="truncate">{recipient}</span>
                      <Button
                        variant="ghost"
                        type="button"
                        aria-label={`${t("persistentAgents.form.trustedRemove")} ${recipient}`}
                        onClick={() =>
                          setTrusted((prev) =>
                            prev.filter((r) => r !== recipient),
                          )
                        }
                        className="h-auto px-2 py-1 text-xs text-muted-foreground"
                      >
                        {t("persistentAgents.form.trustedRemove")}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mx-5 mb-3 px-3 py-2 text-xs rounded-lg bg-destructive/10 text-destructive"
          >
            {error}
          </div>
        )}

        <div className="flex items-center gap-2 px-5 py-3 border-t border-border/60">
          {agent && !confirmDelete && (
            <Button
              variant="ghost"
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="text-xs text-destructive h-auto px-2 py-2"
            >
              {t("persistentAgents.delete.action")}
            </Button>
          )}
          <div className="flex-1" />
          <Button
            variant="ghost"
            type="button"
            onClick={() =>
              confirmDelete ? setConfirmDelete(false) : onClose()
            }
            className="px-4 py-2 text-xs font-medium rounded-lg border border-border text-muted-foreground hover:bg-hover-surface h-auto"
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant={confirmDelete ? "destructive" : "default"}
            type="button"
            disabled={saving}
            onClick={() => void (confirmDelete ? remove() : save())}
            className="px-4 py-2 text-xs font-medium rounded-lg h-auto"
          >
            {confirmDelete
              ? t("persistentAgents.delete.confirm")
              : agent
                ? t("common.save")
                : t("persistentAgents.form.create")}
          </Button>
        </div>
      </DialogContent>
    </OccludingDialog>
  );
}
