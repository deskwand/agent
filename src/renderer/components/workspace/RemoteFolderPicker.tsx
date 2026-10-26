import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Folder } from "lucide-react";
import type { SshDirEntry } from "../../types";
import { Button } from "../app-button";
import { DialogContent, DialogTitle } from "../ui/dialog";
import { OccludingDialog } from "../ui/occluding-dialog";

export function RemoteFolderPicker({
  hostId,
  hostLabel,
  onClose,
  onPick,
}: {
  hostId: string;
  hostLabel: string;
  onClose: () => void;
  onPick: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [path, setPath] = useState<string | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<SshDirEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (next?: string) => {
      try {
        const result = await window.electronAPI.sandbox.ssh.browse({
          hostId,
          path: next,
        });
        setPath(result.path);
        setParent(result.parent);
        setEntries(result.entries.filter((entry) => entry.isDir));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [hostId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <OccludingDialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogTitle>
          {t("sandbox.ssh.pickTitle", { label: hostLabel })}
        </DialogTitle>
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          {parent && (
            <Button variant="ghost" onClick={() => void load(parent)}>
              ..
            </Button>
          )}
          <span className="truncate font-mono">{path ?? ""}</span>
        </div>
        <div className="mt-2 max-h-72 divide-y divide-border overflow-auto rounded-md border border-border">
          {entries.map((entry) => (
            <button
              key={entry.name}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-hover-surface"
              onClick={() =>
                void load(path ? `${path}/${entry.name}` : `/${entry.name}`)
              }
            >
              <Folder className="h-4 w-4 text-muted-foreground" />
              {entry.name}
            </button>
          ))}
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!path} onClick={() => path && onPick(path)}>
            {t("sandbox.ssh.openCurrent", {
              name: path?.split("/").filter(Boolean).pop() ?? "/",
            })}
          </Button>
        </div>
      </DialogContent>
    </OccludingDialog>
  );
}
