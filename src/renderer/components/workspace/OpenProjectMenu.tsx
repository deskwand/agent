import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { FolderOpen, Server } from "lucide-react";
import type { SshHostConfig } from "../../types";

export function OpenProjectMenu({
  anchor,
  hosts,
  onClose,
  onLocal,
  onPickHost,
  onAddServer,
}: {
  anchor: DOMRect;
  hosts: SshHostConfig[];
  onClose: () => void;
  onLocal: () => void;
  onPickHost: (host: SshHostConfig) => void;
  onAddServer: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);

  const top = Math.min(anchor.bottom + 4, window.innerHeight - 280);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ position: "fixed", left: anchor.left, top, zIndex: 60 }}
      className="w-64 rounded-lg border border-border bg-popover p-1 shadow-elevated"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
        onClick={onLocal}
      >
        <FolderOpen className="h-4 w-4 text-muted-foreground" />
        {t("sandbox.ssh.localFolder")}
      </button>
      <div className="my-1 h-px bg-border" />
      <div className="px-2 py-1 text-[11px] text-muted-foreground">
        {t("sandbox.ssh.sectionTitle")}
      </div>
      {hosts.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          {t("sandbox.ssh.noServers")}
        </div>
      ) : (
        hosts.map((host) => (
          <button
            key={host.id}
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => onPickHost(host)}
          >
            <Server className="h-4 w-4 text-muted-foreground" />
            <span className="truncate">{host.label}</span>
            <span className="ml-auto text-[11px] text-muted-foreground">
              {host.username}@{host.host}
            </span>
          </button>
        ))
      )}
      <div className="my-1 h-px bg-border" />
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
        onClick={onAddServer}
      >
        ＋ {t("sandbox.ssh.addServer")}
      </button>
    </div>,
    document.body,
  );
}
