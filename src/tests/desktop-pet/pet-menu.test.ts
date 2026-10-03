import { describe, expect, it } from "vitest";
import { PET_CHARACTERS } from "../../shared/pet-characters";
import { buildPetCharacterMenuTemplate } from "../../main/desktop-pet/pet-menu";

// 不需要 mock electron：vitest.config.mts 的 alias 已把 electron 指向 tests/mocks/electron.ts，
// 且被测算的 buildPetCharacterMenuTemplate 运行时根本不碰 Menu（只有 openPetCharacterMenu 才用）。
const { t } = await import("../../main/i18n");

describe("pet character menu", () => {
  it("lists every character exactly once, as radio items", () => {
    const template = buildPetCharacterMenuTemplate("lens", () => {});
    expect(template).toHaveLength(PET_CHARACTERS.length);
    expect(template.every((item) => item.type === "radio")).toBe(true);
  });

  it("checks the current character and only that one", () => {
    const template = buildPetCharacterMenuTemplate("slime", () => {});
    expect(template.filter((item) => item.checked)).toHaveLength(1);
    expect(template[PET_CHARACTERS.indexOf("slime")].checked).toBe(true);
  });

  it("uses the main-process i18n table for labels", () => {
    const template = buildPetCharacterMenuTemplate("lens", () => {});
    expect(template[0].label).toBe(t("pet.charLens"));
    expect(new Set(template.map((i) => i.label)).size).toBe(
      PET_CHARACTERS.length,
    );
  });

  // 只断言"标签互不相同"挡不住错抄：把 flame 写成 pet.charGhost 照样全绿。
  it("maps every character to its own label key", () => {
    const template = buildPetCharacterMenuTemplate("lens", () => {});
    const expected: Array<[string, string]> = [
      ["lens", "pet.charLens"],
      ["slime", "pet.charSlime"],
      ["ghost", "pet.charGhost"],
      ["flame", "pet.charFlame"],
      ["jellyfish", "pet.charJellyfish"],
      ["octopus", "pet.charOctopus"],
      ["egg", "pet.charEgg"],
    ];
    expect(expected).toHaveLength(PET_CHARACTERS.length);
    for (const [id, key] of expected) {
      expect(template[PET_CHARACTERS.indexOf(id as never)].label).toBe(t(key));
    }
  });

  it("reports the clicked character back", () => {
    const seen: string[] = [];
    const template = buildPetCharacterMenuTemplate("lens", (id) =>
      seen.push(id),
    );
    template[PET_CHARACTERS.indexOf("ghost")].click?.(
      undefined as never,
      undefined as never,
      undefined as never,
    );
    expect(seen).toEqual(["ghost"]);
  });
});
