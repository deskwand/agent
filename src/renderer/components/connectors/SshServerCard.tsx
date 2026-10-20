import { useTranslation } from "react-i18next";
import { MoreHorizontal, Server } from "lucide-react";
import type { SshHostConfig } from "../../types";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

export function SshServerCard({
  host,
  passwordless,
  onTest,
  onEdit,
  onDelete,
}: {
  host: SshHostConfig;
  passwordless: boolean;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="relative flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
      <div className="flex items-center gap-2">
        <Server className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">
          {host.label}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-6 w-6"
              aria-label={t("sandbox.ssh.more")}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onTest}>
              {t("sandbox.ssh.testConnection")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onEdit}>
              {t("common.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDelete}>
              {t("common.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="text-xs text-muted-foreground">
        {host.username}@{host.host}:{host.port}
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span
          className={passwordless ? "text-success" : "text-muted-foreground"}
        >
          {passwordless
            ? t("sandbox.ssh.passwordless")
            : t("sandbox.ssh.needsPassword")}
        </span>
      </div>
    </div>
  );
}
