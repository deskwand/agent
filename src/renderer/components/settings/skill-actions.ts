import type { SkillType } from "../../types";

/**
 * 设置页里能否对技能执行「本机文件操作」（删除 / 发布 / 更新）。
 *
 * 内置技能没有可删的本机副本；密库技能的文件在 `~/.deskwand/vault/skills/`，
 * 由密库页管理（删除去密库页，发布需要先把技能放回本机目录）。
 * 两者若照旧渲染出按钮，点下去只会拿到一句英文错误。
 *
 * 第三方技能（pi 的目录）同理不给：那些文件不属于 DeskWand，本产品一个都不碰。
 */
export function supportsLocalFileActions(type: SkillType): boolean {
  return type !== "builtin" && type !== "vault" && type !== "external";
}
