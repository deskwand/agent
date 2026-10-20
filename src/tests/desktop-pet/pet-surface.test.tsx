// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PetSurface } from "../../renderer/pet-surface";

const IMAGE = "data:image/png;base64,AAAA";

it("renders the custom image with the state on its shell", () => {
  const html = renderToStaticMarkup(
    <PetSurface state="running" character="lens" image={IMAGE} />,
  );
  expect(html).toContain('class="pet-custom"');
  expect(html).toContain('data-state="running"');
  expect(html).toContain(`src="${IMAGE}"`);
});

it("renders the built-in character when no image is set", () => {
  const html = renderToStaticMarkup(
    <PetSurface state="idle" character="ghost" image={null} />,
  );
  expect(html).toContain('class="pet-ghost"');
  expect(html).not.toContain("pet-custom");
});

it("falls back to the built-in character after a decode error", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<PetSurface state="idle" character="ghost" image={IMAGE} />);
  });
  const img = container.querySelector("img");
  expect(img).not.toBeNull();

  await act(async () => {
    img!.dispatchEvent(new Event("error"));
  });
  expect(container.querySelector(".pet-custom")).toBeNull();
  expect(container.querySelector(".pet-ghost")).not.toBeNull();

  // 换一张新图后应恢复图片渲染，而不是永远停在失败标记上。
  await act(async () => {
    root.render(
      <PetSurface state="idle" character="ghost" image={`${IMAGE}B`} />,
    );
  });
  expect(container.querySelector(".pet-custom")).not.toBeNull();

  await act(async () => root.unmount());
  container.remove();
});
