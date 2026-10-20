import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SshHostConfig } from "../../types";
import { Input } from "../ui/input";
import { Button } from "../app-button";
import { DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { OccludingDialog } from "../ui/occluding-dialog";
import { validateSshHostInput, type SshHostInput } from "./ssh-host-validation";

const STAGES = ["key", "password", "bootstrap"] as const;

function defaults(host: SshHostConfig | null): SshHostInput {
  return {
    label: host?.label ?? "",
    host: host?.host ?? "",
    port: host?.port ?? 22,
    username: host?.username ?? "root",
    authMode: host?.authMode ?? "password",
    privateKeyPath: host?.privateKeyPath,
    defaultPath: host?.defaultPath,
  };
}

export function SshServerDialog({
  host,
  onSaved,
  onClose,
}: {
  host: SshHostConfig | null;
  onSaved: (host: SshHostConfig) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<SshHostInput>(defaults(host));
  const [password, setPassword] = useState("");
  const [stage, setStage] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [pendingHost, setPendingHost] = useState<SshHostConfig | null>(null);

  const runTest = async (saved: SshHostConfig) => {
    setStage(0);
    const result = await window.electronAPI.sandbox.ssh.testConnection({
      hostId: saved.id,
      password,
    });
    setStage(result.ok ? STAGES.length : -1);
    if (result.ok) {
      setPassword("");
      onSaved(saved);
      return;
    }
    if (
      result.error?.code === "SSH_HOST_KEY_UNKNOWN" &&
      result.error.fingerprint
    ) {
      setPendingHost(saved);
      setFingerprint(result.error.fingerprint);
      setError(null);
      return;
    }
    setError(result.error?.message ?? t("sandbox.ssh.testFailed"));
  };

  const handleTest = async () => {
    const valid = validateSshHostInput(form);
    if (!valid.ok) {
      setError(t(`sandbox.ssh.error.${valid.error}`));
      return;
    }
    setError(null);
    try {
      const saved = await window.electronAPI.sandbox.ssh.saveHost(form);
      await runTest(saved as SshHostConfig);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const trustAndRetry = async () => {
    if (!pendingHost || !fingerprint) return;
    await window.electronAPI.sandbox.ssh.trustHostKey({
      hostId: pendingHost.id,
      fingerprint,
    });
    setFingerprint(null);
    setPendingHost(null);
    await runTest(pendingHost);
  };

  return (
    <OccludingDialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle>{t("sandbox.ssh.dialogTitle")}</DialogTitle>
        <DialogDescription>{t("sandbox.ssh.dialogHint")}</DialogDescription>
        <div className="mt-3 space-y-2">
          <Input
            value={form.label}
            placeholder={t("sandbox.ssh.fields.label")}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
          <div className="flex gap-2">
            <Input
              value={form.host}
              placeholder={t("sandbox.ssh.fields.host")}
              onChange={(e) => setForm({ ...form, host: e.target.value })}
            />
            <Input
              className="w-24"
              value={String(form.port)}
              onChange={(e) =>
                setForm({ ...form, port: Number(e.target.value) })
              }
            />
          </div>
          <Input
            value={form.username}
            placeholder={t("sandbox.ssh.fields.username")}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
          <div className="flex gap-1">
            {(["password", "key"] as const).map((mode) => (
              <Button
                key={mode}
                variant={form.authMode === mode ? "secondary" : "ghost"}
                onClick={() => setForm({ ...form, authMode: mode })}
              >
                {t(`sandbox.ssh.auth.${mode}`)}
              </Button>
            ))}
          </div>
          {form.authMode === "password" ? (
            <>
              <Input
                type="password"
                value={password}
                placeholder={t("sandbox.ssh.fields.password")}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("sandbox.ssh.passwordHint")}
              </p>
            </>
          ) : (
            <Input
              value={form.privateKeyPath ?? ""}
              placeholder={t("sandbox.ssh.fields.privateKey")}
              onChange={(e) =>
                setForm({ ...form, privateKeyPath: e.target.value })
              }
            />
          )}
          <Input
            value={form.defaultPath ?? ""}
            placeholder={t("sandbox.ssh.fields.defaultPath")}
            onChange={(e) => setForm({ ...form, defaultPath: e.target.value })}
          />
        </div>

        {stage >= 0 && (
          <div className="mt-3 flex divide-x divide-border rounded-md border border-border text-xs">
            {STAGES.map((name, index) => (
              <div
                key={name}
                className={
                  index < stage
                    ? "flex-1 px-2 py-1.5 text-success"
                    : "flex-1 px-2 py-1.5 text-muted-foreground"
                }
              >
                {t(`sandbox.ssh.stage.${name}`)}
              </div>
            ))}
          </div>
        )}

        {fingerprint && (
          <div className="mt-3 rounded-md border border-border bg-muted/40 p-3 text-xs">
            <p className="text-foreground">
              {t("sandbox.ssh.fingerprintTitle")}
            </p>
            <p className="mt-1 break-all font-mono text-muted-foreground">
              {fingerprint}
            </p>
            <div className="mt-2 flex gap-2">
              <Button onClick={() => void trustAndRetry()}>
                {t("sandbox.ssh.trustAndConnect")}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setFingerprint(null);
                  setPendingHost(null);
                }}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )}

        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void handleTest()} disabled={stage >= 0}>
            {stage >= 0
              ? t("sandbox.ssh.testing")
              : t("sandbox.ssh.testConnection")}
          </Button>
        </div>
      </DialogContent>
    </OccludingDialog>
  );
}
