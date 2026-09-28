import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PetLens } from "../../renderer/pet-lens";

it("renders a red lens with a status-specific class", () => {
  expect(renderToStaticMarkup(<PetLens state="running" />)).toContain(
    'data-state="running"',
  );
  expect(renderToStaticMarkup(<PetLens state="failure" />)).toContain(
    'data-state="failure"',
  );
});
