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
