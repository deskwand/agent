/**
 * 桌宠"外形"原生菜单。
 *
 * 为什么是原生菜单：桌宠窗口只有 72×72，自绘菜单会被窗口边界裁掉。
 * 为什么全在主进程：清单（共享模块）、当前值（配置）、文案（主进程 i18n）
 * 三样都在主进程手里，渲染层没有能力也无需送进任何角色数据。
 */
import {
  Menu,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from "electron";
import { PET_CHARACTERS, type PetCharacter } from "../../shared/pet-characters";
import { t } from "../i18n";

/** 显示中的菜单：必须有活引用，否则可能被 GC 收掉导致菜单提前消失。 */
const openMenus = new Set<Menu>();

const LABEL_KEYS: Record<PetCharacter, string> = {
  lens: "pet.charLens",
  slime: "pet.charSlime",
  ghost: "pet.charGhost",
  flame: "pet.charFlame",
  jellyfish: "pet.charJellyfish",
  octopus: "pet.charOctopus",
  egg: "pet.charEgg",
};

export function buildPetCharacterMenuTemplate(
  current: PetCharacter,
  onSelect: (character: PetCharacter) => void,
): MenuItemConstructorOptions[] {
  return PET_CHARACTERS.map((id) => ({
    type: "radio" as const,
    label: t(LABEL_KEYS[id]),
    checked: id === current,
    click: () => onSelect(id),
  }));
}

export function openPetCharacterMenu({
  window,
  current,
  onSelect,
}: {
  window: BrowserWindow;
  current: PetCharacter;
  onSelect: (character: PetCharacter) => void;
}): void {
  const menu = Menu.buildFromTemplate(
    buildPetCharacterMenuTemplate(current, onSelect),
  );
  // 保留活引用：原生菜单没有活引用时可能在显示期间被 GC 收掉。
  openMenus.add(menu);
  menu.once("menu-will-close", () => openMenus.delete(menu));
  // 实测：app 未激活时从 showInactive 显示的窗口弹原生菜单，macOS 上不会显示任何东西。
  // 右键唤起的菜单本来就应该把这个窗口带到前台，所以先 focus 再弹。
  window.focus();
  menu.popup({ window });
}
