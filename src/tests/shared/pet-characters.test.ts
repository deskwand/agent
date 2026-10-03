import { describe, expect, it } from "vitest";
import {
  DEFAULT_PET_CHARACTER,
  PET_CHARACTERS,
  isPetCharacter,
} from "../../shared/pet-characters";

describe("pet characters", () => {
  it("accepts exactly the declared ids", () => {
    for (const id of PET_CHARACTERS) expect(isPetCharacter(id)).toBe(true);
  });

  it("rejects garbage instead of throwing", () => {
    for (const bad of ["", "Lens", "dragon", null, undefined, 7, {}])
      expect(isPetCharacter(bad)).toBe(false);
  });

  it("keeps the default inside the list", () => {
    expect(PET_CHARACTERS).toContain(DEFAULT_PET_CHARACTER);
  });

  it("lists all seven characters, including the four newest", () => {
    expect(PET_CHARACTERS).toHaveLength(7);
    for (const id of ["flame", "jellyfish", "octopus", "egg"] as const)
      expect(PET_CHARACTERS).toContain(id);
  });
});
