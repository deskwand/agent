import { join } from "node:path";
import { getVaultRoot } from "../vault/paths";

/**
 * 想法的根目录（`<vault>/ideas`）。它是密库的一个模块，所以扫描、索引、上传、
 * 恢复都自动跟着走 —— 不要在这里另建一套存储。
 *
 * 路径从 `getVaultRoot()` 取，不自己拼 home：与 `getVaultSkillsRoot()` 同一个
 * 理由 —— 测试里 electron 的 home 是可替换的。
 */
export function getIdeasRoot(): string {
  return join(getVaultRoot(), "ideas");
}
