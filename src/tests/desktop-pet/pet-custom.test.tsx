// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PetState } from "../../main/desktop-pet/pet-state";

const { applyPetCutout } = vi.hoisted(() => ({
  applyPetCutout: vi.fn(),
}));

vi.mock("../../renderer/pet-cutout-apply", () => ({ applyPetCutout }));

import { PetCustom } from "../../renderer/pet-custom";

const SRC = "data:image/png;base64,SRC";
const CUT = "data:image/png;base64,CUT";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  applyPetCutout.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(src: string, state: PetState = "idle") {
  await act(async () => {
    root.render(<PetCustom state={state} src={src} onError={() => {}} />);
  });
}

const imgSrc = () => container.querySelector("img")?.getAttribute("src");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

it("shows the original immediately, then swaps to the cutout", async () => {
  const cut = deferred<string | null>();
  applyPetCutout.mockReturnValue(cut.promise);
  await render(SRC);
  expect(imgSrc()).toBe(SRC);
  cut.resolve(CUT);
  await vi.waitFor(() => expect(imgSrc()).toBe(CUT));
  expect(applyPetCutout).toHaveBeenCalledWith(SRC);
});

it("keeps the original when the cutout returns null", async () => {
  applyPetCutout.mockResolvedValue(null);
  await render(SRC);
  await act(async () => {
    await Promise.resolve();
  });
  expect(imgSrc()).toBe(SRC);
});

it("re-applies for a new src and does not recompute on state changes", async () => {
  const first = deferred<string | null>();
  applyPetCutout.mockReturnValueOnce(first.promise);
  await render(SRC);
  first.resolve(CUT);
  await vi.waitFor(() => expect(imgSrc()).toBe(CUT));

  const second = deferred<string | null>();
  applyPetCutout.mockReturnValueOnce(second.promise);
  await render("data:image/png;base64,SRC2", "running");
  expect(imgSrc()).toBe("data:image/png;base64,SRC2");
  second.resolve("data:image/png;base64,CUT2");
  await vi.waitFor(() => expect(imgSrc()).toBe("data:image/png;base64,CUT2"));
  expect(applyPetCutout).toHaveBeenCalledTimes(2);

  await render("data:image/png;base64,SRC2", "success");
  expect(applyPetCutout).toHaveBeenCalledTimes(2);
  expect(
    container.querySelector(".pet-custom")?.getAttribute("data-state"),
  ).toBe("success");
});

it("ignores a stale cutout result after the src changes", async () => {
  const first = deferred<string | null>();
  const second = deferred<string | null>();
  applyPetCutout
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);

  await render(SRC);
  await render("data:image/png;base64,SRC2");
  second.resolve("data:image/png;base64,CUT2");
  await vi.waitFor(() => expect(imgSrc()).toBe("data:image/png;base64,CUT2"));

  first.resolve("data:image/png;base64,CUT1");
  await act(async () => {
    await Promise.resolve();
  });
  expect(imgSrc()).toBe("data:image/png;base64,CUT2");
});
