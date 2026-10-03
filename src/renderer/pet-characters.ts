import type { ComponentType } from "react";
import type { PetState } from "../main/desktop-pet/pet-state";
import type { PetCharacter } from "../shared/pet-characters";
import { PetEgg } from "./pet-egg";
import { PetFlame } from "./pet-flame";
import { PetGhost } from "./pet-ghost";
import { PetJellyfish } from "./pet-jellyfish";
import { PetLens } from "./pet-lens";
import { PetOctopus } from "./pet-octopus";
import { PetSlime } from "./pet-slime";

export interface PetCharacterProps {
  state: PetState;
}

/**
 * 角色 → 组件：穷尽映射，漏一只就编译不过（与 WelcomeView 的 QUICK_ENTRY_ICONS 同一手法）。
 * 镜片只声明 `{ state }`——更窄的 props 可直接放进这里，不必为"统一签名"改它。
 *
 * 单独成模块（而不是写在 pet.tsx 里）是为了**能被测试直接驱动**：pet.tsx 在模块顶层就
 * `createRoot(...)`，测试导入它会连带启动窗口。这里没有任何副作用，测试可以逐 id 断言
 * "这个 id 渲染出来的根类名就是它自己"——否则把 egg 指向 PetOctopus 也能全绿。
 */
export const PET_CHARACTER_COMPONENTS: Record<
  PetCharacter,
  ComponentType<PetCharacterProps>
> = {
  lens: PetLens,
  slime: PetSlime,
  ghost: PetGhost,
  flame: PetFlame,
  jellyfish: PetJellyfish,
  octopus: PetOctopus,
  egg: PetEgg,
};
