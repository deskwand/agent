// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodingSubscriptionCards } from "../src/renderer/components/settings/coding-subscription-cards";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("coding subscription cards", () => {
  let root: Root;
  const container = document.createElement("div");
  afterEach(() => {
    if (root) act(() => root.unmount());
    container.replaceChildren();
  });

  it("renders distinct, decorative icons beside readable plan names", async () => {
    root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(CodingSubscriptionCards, {
          profiles: {},
          onSave: vi.fn(),
          onDelete: vi.fn(),
        }),
      ),
    );
    const bailian = container.querySelector(
      '[data-testid="custom:subscription-bailian-coding-card"]',
    )!;
    const ark = container.querySelector(
      '[data-testid="custom:subscription-ark-coding-card"]',
    )!;
    const cloud = bailian.querySelector("svg");
    const mountain = ark.querySelector("svg");
    expect(cloud).not.toBeNull();
    expect(mountain).not.toBeNull();
    expect(cloud!.getAttribute("aria-hidden")).toBe("true");
    expect(mountain!.getAttribute("aria-hidden")).toBe("true");
    expect(cloud!.querySelectorAll("path")).toHaveLength(1);
    expect(mountain!.querySelectorAll("path")).toHaveLength(2);
    expect(bailian.querySelector(".min-w-0 .truncate")?.textContent).toBe(
      "百炼 Coding Plan",
    );
    expect(ark.querySelector(".min-w-0 .truncate")?.textContent).toBe(
      "火山方舟 Coding Plan",
    );
  });

  it("configures a key without using the OAuth login flow or displaying the saved key", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(CodingSubscriptionCards, {
          profiles: {},
          onSave,
          onDelete,
        }),
      ),
    );
    const card = container.querySelector(
      '[data-testid="custom:subscription-bailian-coding-card"]',
    )!;
    await act(async () =>
      (
        card.querySelector(
          'button[data-action="configure"]',
        ) as HTMLButtonElement
      ).click(),
    );
    const input = card.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "sk-sp-test");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      (
        card.querySelector('button[data-action="save"]') as HTMLButtonElement
      ).click(),
    );
    expect(onSave).toHaveBeenCalledWith(
      "custom:subscription-bailian-coding",
      "sk-sp-test",
    );
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("displays configured state without prefilling the secret, and confirms removal", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(CodingSubscriptionCards, {
          profiles: {
            "custom:subscription-ark-coding": { apiKey: "secret-key" },
          },
          onSave,
          onDelete,
        }),
      ),
    );
    const card = container.querySelector(
      '[data-testid="custom:subscription-ark-coding-card"]',
    )!;
    expect(card.textContent).toContain("api.subscriptionConfigured");
    expect(card.textContent).not.toContain("secret-key");
    await act(async () =>
      (
        card.querySelector(
          'button[data-action="configure"]',
        ) as HTMLButtonElement
      ).click(),
    );
    const keyInput = card.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    expect(keyInput.value).toBe("");
    expect(keyInput.autocomplete).toBe("new-password");
    await act(async () =>
      (
        card.querySelector('button[data-action="remove"]') as HTMLButtonElement
      ).click(),
    );
    expect(onDelete).not.toHaveBeenCalled();
    await act(async () =>
      (
        card.querySelector(
          'button[data-action="confirm-remove"]',
        ) as HTMLButtonElement
      ).click(),
    );
    expect(onDelete).toHaveBeenCalledWith("custom:subscription-ark-coding");
  });
});
