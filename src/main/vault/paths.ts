import { app } from "electron";
import { join } from "node:path";

/**
 * 密库的唯一根目录。模块（`files/`、`skills/`）与内部条目都落在这里。
 *
 * 用 `app.getPath("home")` 而不是 `os.homedir()`：与 SkillsManager 的
 * `.deskwand/skills` 保持同一个基准目录（生产环境两者等价，但测试里 electron
 * 的 home 是可替换的，用 homedir() 会读开发者真实家目录）。
 */
export function getVaultRoot(): string {
  return join(app.getPath("home"), ".deskwand", "vault");
}

/**
 * 技能模块的根目录（`<vault>/skills`）。独立于 `~/.deskwand/skills` —— 后者是
 * 全部技能的加载来源（内置链接、agent 创建、市场安装都落在那里），不能交给密库接管。
 */
export function getVaultSkillsRoot(): string {
  return join(getVaultRoot(), "skills");
}

/**
 * 全局技能目录。与 SkillsManager 的默认全局技能路径**必须**是同一个基准：
 * 密库侧要按这个目录列出可上传的候选，而设置页/斜杠菜单按 SkillsManager 的
 * 解析结果读技能 —— 两处分叉会列出「点了找不到」的候选。
 */
export function getGlobalSkillsRoot(): string {
  return join(app.getPath("home"), ".deskwand", "skills");
}
