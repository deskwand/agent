import { homedir } from "node:os";
import { join } from "node:path";

/**
 * 技能密库的根目录。独立于 `~/.deskwand/skills` —— 后者是全部技能的加载来源
 * （内置链接、agent 创建、市场安装都落在那里），不能交给 skills scope 接管。
 */
export function getVaultSkillsRoot(): string {
  return join(homedir(), ".deskwand", "vault-skills");
}
