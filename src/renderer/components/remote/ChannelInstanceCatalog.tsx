import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import { ChannelLogo } from "./channel-logos";
import type {
  ChannelInstanceConfig,
  ChannelInstanceStatus,
  ChannelRuntimeInstanceType,
  ChannelPairingEvent,
} from "../../../shared/ipc-types";
import type { ServerEvent } from "../../types";

const CHANNEL_TYPES: ChannelRuntimeInstanceType[] = [
  "feishu",
  "telegram",
  "discord",
  "qq",
  "slack",
  "wechat",
];

const TOKEN_CHANNELS: Set<ChannelRuntimeInstanceType> = new Set([
  "telegram",
  "discord",
  "slack",
]);

const APP_CHANNELS: Set<ChannelRuntimeInstanceType> = new Set([
  "feishu",
  "qq",
]);

const STATUS_DOT: Record<ChannelInstanceStatus["state"], string> = {
  connected: "dot-connected",
  starting: "dot-starting",
  reconnecting: "dot-reconnecting",
  failed: "dot-failed",
  stopped: "dot-stopped",
  draining: "dot-stopped",
  stopping: "dot-stopped",
};

const PAIRING_STATE_ORDER: Record<ChannelPairingEvent["state"], number> = {
  pending: 0,
  scanned: 1,
  expired: 2,
  confirmed: 3,
  failed: 3,
};

function applyPairingEvent(
  current: Map<string, ChannelPairingEvent>,
  incoming: ChannelPairingEvent,
): Map<string, ChannelPairingEvent> {
  const existing = current.get(incoming.channelInstanceId);
  if (existing) {
    if (incoming.generation < existing.generation) return current;
    if (incoming.generation === existing.generation) {
      if (incoming.timestamp < existing.timestamp) return current;
      if (
        incoming.timestamp === existing.timestamp &&
        PAIRING_STATE_ORDER[incoming.state] <=
          PAIRING_STATE_ORDER[existing.state]
      ) {
        return current;
      }
    }
  }
  const next = new Map(current);
  if (
    incoming.state === "confirmed" ||
    incoming.state === "expired" ||
    incoming.state === "failed"
  ) {
    next.set(incoming.channelInstanceId, { ...incoming, imageUrl: undefined });
  } else {
    next.set(incoming.channelInstanceId, incoming);
  }
  return next;
}

function credentialFields(
  type: ChannelRuntimeInstanceType,
): Array<{ key: string; label: string }> {
  if (TOKEN_CHANNELS.has(type)) return [{ key: "botToken", label: "remote.credentialBotToken" }];
  if (APP_CHANNELS.has(type))
    return [
      { key: "appId", label: "remote.credentialAppId" },
      { key: "appSecret", label: "remote.credentialAppSecret" },
    ];
  return [];
}

function capitalize(value: string): string {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function ChannelInstanceCatalog() {
  const { t } = useTranslation();
  const [instances, setInstances] = useState<ChannelInstanceConfig[]>([]);
  const [statuses, setStatuses] = useState<ChannelInstanceStatus[]>([]);
  const [pairings, setPairings] = useState<Map<string, ChannelPairingEvent>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(false);
  const [expandedEdit, setExpandedEdit] = useState<Set<string>>(new Set());
  const [editValues, setEditValues] = useState<Map<string, Record<string, string>>>(new Map());
  const [confirming, setConfirming] = useState<string | null>(null);
  const isElectron =
    typeof window !== "undefined" && window.electronAPI !== undefined;

  /** Renders a QR code image from a text/URL payload. */
  function QrImage({ value, alt }: { value: string; alt: string }) {
    const [dataUrl, setDataUrl] = useState<string | null>(null);
    useEffect(() => {
      let cancelled = false;
      QRCode.toDataURL(value, {
        width: 224,
        margin: 1,
        errorCorrectionLevel: "M",
      })
        .then((url) => {
          if (!cancelled) setDataUrl(url);
        })
        .catch(() => {
          // QR generation failure leaves the placeholder hidden.
        });
      return () => {
        cancelled = true;
      };
    }, [value]);
    if (!dataUrl) return null;
    return (
      <img
        src={dataUrl}
        alt={alt}
        className="h-28 w-28 rounded-xl bg-background p-2"
      />
    );
  }

  const refresh = useCallback(async () => {
    if (!isElectron) return;
    const [instancesResult, statusesResult] = await Promise.all([
      window.electronAPI.remote.listChannels(),
      window.electronAPI.remote.getChannelStatus(),
    ]);
    setInstances(instancesResult);
    setStatuses(statusesResult);
  }, [isElectron]);

  // Subscribe to live status and pairing events.
  useEffect(() => {
    if (!isElectron) return;
    let cancelled = false;
    const unsubscribe = window.electronAPI.on((event: ServerEvent) => {
      if (event.type === "remote.channelPairing") {
        setPairings((prev) => applyPairingEvent(prev, event.payload));
      }
      if (
        (
          event as unknown as { type: string; payload: unknown }
        ).type === "remote.channelStatus"
      ) {
        const status = (
          event as unknown as { payload: ChannelInstanceStatus }
        ).payload as ChannelInstanceStatus;
        setStatuses((prev) => {
          const idx = prev.findIndex((s) => s.id === status.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = status;
            return next;
          }
          return [...prev, status];
        });
      }
    });
    void window.electronAPI.remote
      .getChannelPairings()
      .then((snapshots) => {
        if (cancelled) return;
        setPairings((prev) => {
          let next = prev;
          for (const event of snapshots) next = applyPairingEvent(next, event);
          return next;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [isElectron]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async (type: ChannelRuntimeInstanceType) => {
    if (!isElectron) return;
    setLoading(true);
    try {
      await window.electronAPI.remote.createChannel({
        name: capitalize(type),
        type,
        enabled: false,
        config: {},
      });
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id: string) => {
    if (!isElectron) return;
    await window.electronAPI.remote.deleteChannel(id);
    setPairings((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    await refresh();
  };

  const toggle = async (instance: ChannelInstanceConfig) => {
    if (!isElectron) return;
    const enabled = !instance.enabled;
    await window.electronAPI.remote.updateChannel(instance.id, { enabled });
    setInstances((prev) =>
      prev.map((i) => (i.id === instance.id ? { ...i, enabled } : i)),
    );
  };

  const toggleEdit = (id: string, instance: ChannelInstanceConfig) => {
    const isCurrentlyEditing = expandedEdit.has(id);
    if (!isCurrentlyEditing) {
      const creds = credentialFields(instance.type);
      const init: Record<string, string> = {};
      for (const field of creds) {
        init[field.key] =
          typeof instance.config[field.key] === "string"
            ? (instance.config[field.key] as string)
            : "";
      }
      setEditValues((prev) => new Map(prev).set(id, init));
    }
    setExpandedEdit((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveCredentials = async (instance: ChannelInstanceConfig) => {
    if (!isElectron) return;
    const values = editValues.get(instance.id);
    if (!values) return;
    const config: Record<string, unknown> = {};
    const creds = credentialFields(instance.type);
    for (const field of creds) {
      const raw = values[field.key]?.trim() ?? "";
      if (raw.length > 0) config[field.key] = raw;
    }
    try {
      await window.electronAPI.remote.updateChannel(instance.id, { config });
    } catch {
      return; // Keep edit area open on failure so user can retry.
    }
    setExpandedEdit((prev) => {
      const next = new Set(prev);
      next.delete(instance.id);
      return next;
    });
    await refresh();
  };

  const updateEditValue = (
    instanceId: string,
    field: string,
    value: string,
  ) => {
    setEditValues((prev) => {
      const map = new Map(prev);
      const existing = { ...(map.get(instanceId) ?? {}) };
      existing[field] = value;
      map.set(instanceId, existing);
      return map;
    });
  };

  const statusMap = new Map(statuses.map((s) => [s.id, s]));

  return (
    <section className="space-y-4 rounded-6xl border border-border-subtle bg-background/60 p-6">
      <div>
        <h2 className="text-base font-semibold text-text-primary">
          {t("remote.channelCatalog")}
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          {t("remote.channelCatalogDesc")}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {CHANNEL_TYPES.map((item) => {
          const added = instances.some((i) => i.type === item);
          return (
            <button
              key={item}
              type="button"
              data-channel-add={item}
              aria-disabled={added}
              disabled={added || loading}
              onClick={() => void create(item)}
              className="flex flex-col items-center gap-1 rounded-xl border border-border-subtle px-2 py-3 text-xs text-text-muted transition-colors hover:border-accent hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChannelLogo type={item} size={24} />
              <span>{t(`channelNames.${item}`)}</span>
              {added && <span className="text-[10px] text-success">✓</span>}
            </button>
          );
        })}
      </div>
      {instances.length === 0 ? (
        <p className="text-sm text-text-muted">{t("remote.noChannels")}</p>
      ) : (
        <ul className="space-y-2">
          {instances.map((instance) => {
            const pairing =
              instance.type === "wechat"
                ? pairings.get(instance.id)
                : undefined;
            const st = statusMap.get(instance.id);
            const state: ChannelInstanceStatus["state"] =
              st?.state ?? "stopped";
            const displayState = instance.enabled ? state : "disabled";
            const isEditing = expandedEdit.has(instance.id);
            const creds = credentialFields(instance.type);

            return (
              <li
                key={instance.id}
                data-channel-instance-id={instance.id}
                className="rounded-xl border border-border-subtle px-3 py-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        instance.enabled ? STATUS_DOT[state] : "dot-stopped"
                      }`}
                    />
                    <ChannelLogo type={instance.type} size={20} />
                    <div>
                      <div className="text-sm text-text-primary">
                        {t(`channelNames.${instance.type}`)}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-text-muted">
                        <span
                          className={`status-${instance.enabled ? state : "stopped"}`}
                        >
                          · {t(`remote.channelStatus.${displayState}`)}
                        </span>
                        {st?.error && (
                          <span className="text-error">· {st.error}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {creds.length > 0 && (
                      <button
                        type="button"
                        data-edit
                        onClick={() => toggleEdit(instance.id, instance)}
                        className="rounded-lg px-2 py-1 text-xs text-text-muted hover:text-text-primary"
                      >
                        {t(
                          isEditing
                            ? "remote.cancelEdit"
                            : "remote.edit",
                        )}
                      </button>
                    )}
                    {/* Enable / disable toggle */}
                    <button
                      type="button"
                      className={`toggle-track ${instance.enabled ? "toggle-on" : ""}`}
                      onClick={() => void toggle(instance)}
                      aria-label={t(
                        instance.enabled
                          ? "remote.disableChannel"
                          : "remote.enableChannel",
                      )}
                    >
                      <span className="toggle-knob" />
                    </button>
                    {confirming === instance.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            void remove(instance.id);
                            setConfirming(null);
                          }}
                          className="rounded-lg px-2 py-1 text-xs text-error"
                        >
                          {t("remote.confirm")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirming(null)}
                          className="rounded-lg px-2 py-1 text-xs text-text-muted"
                        >
                          {t("remote.cancelEdit")}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirming(instance.id)}
                        aria-label={t("remote.deleteChannel")}
                        className="rounded-lg p-2 text-text-muted hover:text-error"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Credential edit */}
                {isEditing && creds.length > 0 && (
                  <div className="mt-3 border-t border-border-subtle pt-3 space-y-2">
                    {creds.map((field) => (
                      <div key={field.key}>
                        <label className="mb-1 block text-xs text-text-muted">
                          {t(field.label)}
                        </label>
                        <input
                          type="password"
                          value={editValues.get(instance.id)?.[field.key] ?? ""}
                          onChange={(event) =>
                            updateEditValue(
                              instance.id,
                              field.key,
                              event.target.value,
                            )
                          }
                          placeholder={t(field.label)}
                          className="w-full rounded-lg border border-border-subtle bg-background px-3 py-2 text-sm text-text-primary"
                        />
                      </div>
                    ))}
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedEdit((prev) => {
                            const next = new Set(prev);
                            next.delete(instance.id);
                            return next;
                          })
                        }
                        className="rounded-lg px-3 py-1 text-xs text-text-muted hover:text-text-primary"
                      >
                        {t("remote.cancelEdit")}
                      </button>
                      <button
                        type="button"
                        data-save
                        onClick={() => void saveCredentials(instance)}
                        className="rounded-lg bg-accent px-3 py-1 text-xs text-accent-foreground"
                      >
                        {t("remote.saveCredentials")}
                      </button>
                    </div>
                  </div>
                )}

                {/* WeChat QR pairing */}
                {pairing && pairing.state !== "confirmed" && (
                  <div className="mt-3 flex gap-4 border-t border-border-subtle pt-3">
                    {pairing.imageUrl && (
                      <QrImage
                        value={pairing.imageUrl}
                        alt={t("remote.wechatQrAlt")}
                      />
                    )}
                    <div>
                      {pairing.imageUrl && (
                        <div className="text-sm font-medium text-text-primary">
                          {t("remote.wechatScanTitle")}
                        </div>
                      )}
                      <div className="mt-1 text-xs text-text-muted">
                        {t(`remote.wechatPairingState.${pairing.state}`)}
                      </div>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
