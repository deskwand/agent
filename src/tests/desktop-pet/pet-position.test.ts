import { expect, it } from "vitest";
import {
  clampToDisplay,
  restorePosition,
  type PetDisplay,
} from "../../main/desktop-pet/pet-position";

const displays: PetDisplay[] = [
  { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
  { id: 2, workArea: { x: 1920, y: 0, width: 1920, height: 1080 } },
];

it("allows a dragged window to land on the second monitor", () => {
  expect(clampToDisplay({ x: 1940, y: 300 }, 120, displays[1])).toEqual({
    x: 1940,
    y: 300,
  });
});

it("restores a saved position and clamps it into a resized work area", () => {
  expect(
    restorePosition({ displayId: 2, x: 3600, y: 990 }, 120, displays),
  ).toEqual({ x: 3600, y: 960 });
});

it("falls back to the primary display when saved display is gone", () => {
  expect(
    restorePosition(
      { displayId: 2, x: 2000, y: 500 },
      120,
      displays.slice(0, 1),
    ),
  ).toEqual({ x: 1784, y: 944 });
});
