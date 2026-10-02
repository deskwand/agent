import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PetSlime } from "../../renderer/pet-slime";
import { PetGhost } from "../../renderer/pet-ghost";
import { PetLens } from "../../renderer/pet-lens";

it("renders each character with its own root class and the current state", () => {
  const cases = [
    [PetLens, "pet-lens"],
    [PetSlime, "pet-slime"],
    [PetGhost, "pet-ghost"],
  ] as const;
  for (const [Component, className] of cases) {
    const html = renderToStaticMarkup(<Component state="failure" />);
    expect(html).toContain(`data-state="failure"`);
    expect(html).toContain(className);
  }
});
