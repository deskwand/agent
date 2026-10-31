import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Folder } from "lucide-react";
import { DEFAULT_WORKDIR_DIRNAME } from "../../../shared/workspace-path";
import type { WorkspaceProject } from "../../utils/sidebar-session-groups";
import { Button } from "../app-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

export interface ProjectMenuChipProps {
  /** 当前项目路径；null = 不在任何项目里（新会话落主进程默认目录）。 */
  workingDir: string | null;
  projects: WorkspaceProject[];
  /** 参数为 null 表示「默认工作区」。 */
  onSelectProject: (cwd: string | null) => void;
}

/**
 * cwd → 展示名。末段目录名，与侧边栏分组的 `workspaceName()` 同口径
 *（唯一差别：那边先过一遍 `normalizeWorkspacePath()` 做 trim，我们只取末段）。
 */
function projectNameOf(cwd: string): string {
  const segments = cwd.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || cwd;
}

/**
 * 输入框底栏的项目 chip。纯展示：不认识 store、不认识 IPC，选中只往外抛。
 *
 * 显示名与「当前项」都取自 `workingDir`，**不取**自 `projects` —— 首屏会话列表还没
 * 加载完（空数组）时，chip 也得认得当前项目。
 */
export function ProjectMenuChip({
  workingDir,
  projects,
  onSelectProject,
}: ProjectMenuChipProps) {
  const { t } = useTranslation();
  const defaultLabel = t("welcome.projectMenu.defaultWorkspace");
  // 「默认工作区」两种情形合一：没有 workingDir，或路径正好是默认工作目录。
  // 这枚 chip 现在是项目名的**唯一出口**（标题不再重复它）——所以这个归一必须
  // 对，否则界面上唯一的落点信息会显示成 `default_working_dir`。
  const name = workingDir ? projectNameOf(workingDir) : "";
  // 与 projects 里的 cwd 直接比字符串：两边同源 —— 列表那条是 `listWorkspaceProjects()`
  // 规范化过的，当前这条是它经 `workdir.set` **原样回传**的值（`src/main/index.ts:1020`），
  // 不另写一份规范化（本流程里不存在"写法不同的同一目录"）。
  const currentCwd =
    workingDir && name && name !== DEFAULT_WORKDIR_DIRNAME ? workingDir : null;
  const currentName = currentCwd ? name : defaultLabel;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          type="button"
          aria-label={t("welcome.projectMenu.triggerLabel", {
            name: currentName,
          })}
          // h-9 与相邻的附件/麦克风圆钮同高；max-w + min-w-0 + truncate 是长项目名唯一的收口处：
          // 窗口 800（应用最小宽） + 侧边栏拖到上限 400 时，底栏只有 320px，而
          // 左簇满宽 250 + 右簇（模型 chip/环/发送键）最小 106 = 356 —— 多出的 36px
          // 必须从 chip 的名子上收。实测见表头注释。
          className="h-9 min-w-0 max-w-[8.5rem] gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground"
        >
          <Folder className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{currentName}</span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-[17rem]">
        <DropdownMenuLabel className="px-2 py-1 text-xs text-muted-foreground">
          {t("welcome.projectMenu.title")}
        </DropdownMenuLabel>
        <DropdownMenuItem
          className="gap-2 text-xs"
          aria-current={!currentCwd ? "true" : undefined}
          onSelect={() => onSelectProject(null)}
        >
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{defaultLabel}</span>
          {!currentCwd && (
            <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-success" />
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {projects.length === 0 ? (
          <DropdownMenuItem disabled className="text-xs">
            {t("welcome.projectMenu.empty")}
          </DropdownMenuItem>
        ) : (
          projects.map((project) => (
            <DropdownMenuItem
              key={project.cwd}
              className="gap-2 text-xs"
              aria-current={currentCwd === project.cwd ? "true" : undefined}
              onSelect={() => onSelectProject(project.cwd)}
            >
              <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{project.name}</span>
              {currentCwd === project.cwd && (
                <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-success" />
              )}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
