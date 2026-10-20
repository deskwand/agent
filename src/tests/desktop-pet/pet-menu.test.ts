import { describe, expect, it } from "vitest";
import { PET_CHARACTERS } from "../../shared/pet-characters";
import {
  buildPetCharacterMenuTemplate,
  type PetCharacterMenuOptions,
} from "../../main/desktop-pet/pet-menu";

const { t } = await import("../../main/i18n");

function build(
  overrides: Partial<PetCharacterMenuOptions> = {},
): ReturnType<typeof buildPetCharacterMenuTemplate> {
  return buildPetCharacterMenuTemplate({
    character: "lens",
    customImage: null,
    onSelectCharacter: () => {},
    onSelectCustomImage: () => {},
    onChooseCustomImage: () => {},
    onRemoveCustomImage: () => {},
    ...overrides,
  });
}

const labels = (overrides: Partial<PetCharacterMenuOptions> = {}) =>
  build(overrides).map((item) => item.label);

describe("pet character menu", () => {
  it("offers the custom image picker before the built-in characters", () => {
    const template = build();
    expect(template[0]).toMatchObject({ label: t("pet.chooseImage") });
    expect(template[1]).toMatchObject({ type: "separator" });
    expect(template.slice(2)).toHaveLength(PET_CHARACTERS.length);
    expect(template.slice(2).every((item) => item.type === "radio")).toBe(true);
  });

  it("lists custom image controls only when a record exists", () => {
    expect(labels()).not.toContain(t("pet.customImage"));
    expect(labels()).not.toContain(t("pet.removeImage"));

    expect(labels({ customImage: { enabled: true, exists: true } })).toContain(
      t("pet.customImage"),
    );
    expect(labels({ customImage: { enabled: true, exists: true } })).toContain(
      t("pet.removeImage"),
    );
  });

  it("hides the custom radio but keeps remove when the file is gone", () => {
    const template = build({
      customImage: { enabled: true, exists: false },
    });
    expect(
      labels({ customImage: { enabled: true, exists: false } }),
    ).not.toContain(t("pet.customImage"));
    expect(template.map((item) => item.label)).toContain(t("pet.removeImage"));

    const checked = template.filter((item) => item.checked);
    expect(checked).toHaveLength(1);
    expect(checked[0].label).toBe(t("pet.charLens"));
  });

  it("checks the custom image when it is active and present", () => {
    const template = build({
      customImage: { enabled: true, exists: true },
    });
    const checked = template.filter((item) => item.checked);
    expect(checked).toHaveLength(1);
    expect(checked[0].label).toBe(t("pet.customImage"));
  });

  it("checks the built-in character when the custom image is disabled", () => {
    const template = build({
      character: "ghost",
      customImage: { enabled: false, exists: true },
    });
    const checked = template.filter((item) => item.checked);
    expect(checked).toHaveLength(1);
    expect(checked[0].label).toBe(t("pet.charGhost"));
  });

  it("uses the main-process i18n table and maps every character", () => {
    const template = build({
      customImage: { enabled: false, exists: true },
    });
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
      const item = template.find((entry) => entry.label === t(key));
      expect(item, `${id} is missing`).toBeDefined();
      expect(item?.type).toBe("radio");
    }
  });

  it("reports clicks for choose, custom, remove and built-ins", () => {
    const seen: string[] = [];
    const template = build({
      customImage: { enabled: false, exists: true },
      onSelectCharacter: (id) => seen.push(`char:${id}`),
      onSelectCustomImage: () => seen.push("custom"),
      onChooseCustomImage: () => seen.push("choose"),
      onRemoveCustomImage: () => seen.push("remove"),
    });
    const click = (label: string) =>
      template
        .find((item) => item.label === label)
        ?.click?.(undefined as never, undefined as never, undefined as never);

    click(t("pet.chooseImage"));
    click(t("pet.customImage"));
    click(t("pet.removeImage"));
    click(t("pet.charGhost"));
    expect(seen).toEqual(["choose", "custom", "remove", "char:ghost"]);
  });
});
