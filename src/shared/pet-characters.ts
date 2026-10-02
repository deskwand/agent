/**
 * 桌宠角色清单：主进程与渲染层共用。
 *
 * 只放 id——显示名走主进程的 i18n（`src/main/i18n` 的 MSG 表），
 * 因为只有主进程要画原生菜单，渲染层从不显示角色名。
 * 校验模式与 themePreset 一致：非法值一律回退默认，不抛错。
 */
export const PET_CHARACTERS = ["lens", "slime", "ghost"] as const;

export type PetCharacter = (typeof PET_CHARACTERS)[number];

export const DEFAULT_PET_CHARACTER: PetCharacter = "lens";

export function isPetCharacter(value: unknown): value is PetCharacter {
  return (
    typeof value === "string" &&
    (PET_CHARACTERS as readonly string[]).includes(value)
  );
}
