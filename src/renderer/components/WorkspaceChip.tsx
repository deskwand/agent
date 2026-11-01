import { useTranslation } from "react-i18next";
import { Folder } from "lucide-react";

/**
 * 只读目录 chip。
 *
 * 为什么不做成下拉：会话的工作目录在会话建立后由主进程与会话绑定，改目录要新建
 * 会话才成立；给一枚看起来能改的胶囊只会制造假入口。欢迎页那个
 * `ProjectMenuChip` 是入口（还没绑会话），这里是事实。
 */
export function WorkspaceChip({ cwd }: { cwd: string | null }) {
  const { t } = useTranslation();
  if (!cwd) return null;
  const name = cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;
  return (
    <span
      title={cwd}
      aria-label={t("chat.workspaceChip", { path: cwd })}
      className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md px-1 py-0.5 text-[11px] text-muted-foreground"
    >
      <Folder aria-hidden="true" className="h-3 w-3 flex-shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  );
}
