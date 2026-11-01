// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PartnerAvatar } from "../../renderer/components/agents/PartnerAvatar";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function srcFor(seed: string): string {
  act(() => root.render(<PartnerAvatar seed={seed} size={24} />));
  return container.querySelector("img")!.getAttribute("src")!;
}

describe("PartnerAvatar", () => {
  it("is deterministic per seed", () => {
    expect(srcFor("a")).toBe(srcFor("a"));
    expect(srcFor("a")).not.toBe(srcFor("b"));
  });

  it("renders for an empty seed", () => {
    expect(srcFor("")).toMatch(/^data:image\/svg\+xml/);
  });
});
