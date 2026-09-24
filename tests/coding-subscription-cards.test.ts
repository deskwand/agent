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

  const byExactText = (root: HTMLElement, text: string) =>
    [...root.querySelectorAll("div")].find(
      (el) => el.textContent === text,
    ) as HTMLDivElement;

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

  it("styles the configure button as the primary action while unconfigured", async () => {
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
    // 两张卡片都未配置 → 都与上面 OAuth 卡片的「连接」同为蓝色实心
    for (const key of [
      "custom:subscription-bailian-coding",
      "custom:subscription-ark-coding",
    ]) {
      const button = container
        .querySelector(`[data-testid="${key}-card"]`)!
        .querySelector('button[data-action="configure"]')!;
      expect(button.classList.contains("bg-accent")).toBe(true);
      expect(button.classList.contains("text-accent-foreground")).toBe(true);
      expect(button.classList.contains("border-border-muted")).toBe(false);
    }
  });

  it("keeps every text line in the same column and the icon outside it", async () => {
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
    const card = container.querySelector(
      '[data-testid="custom:subscription-bailian-coding-card"]',
    )!;

    const title = card.querySelector(".truncate")!;
    const desc = byExactText(card, "api.subscriptionBailianNote");
    const links = byExactText(
      card,
      "api.subscriptionGetKey · api.subscriptionTerms",
    );
    const icon = card.querySelector("svg")!;

    expect(desc).toBeTruthy();
    expect(links).toBeTruthy();
    const column = desc.parentElement!;
    const leftBlock = column.parentElement!;
    // 四行文字同属一个文字列 → 共享同一左边缘
    expect(column.contains(title)).toBe(true);
    expect(column.contains(links)).toBe(true);
    // 文字列参与收缩，长标题才截断而不撑破该行
    expect(column.classList.contains("min-w-0")).toBe(true);
    // 图标在该列之外、紧邻其左侧，且与标题首行齐平
    expect(column.contains(icon)).toBe(false);
    expect(icon.parentElement).toBe(leftBlock);
    expect(icon.nextElementSibling).toBe(column);
    expect(leftBlock.classList.contains("items-start")).toBe(true);
    expect(icon.classList.contains("mt-px")).toBe(true);
  });

  it("spans the card rather than the text column so the save button stays flush right", async () => {
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
    const row = input.parentElement!;
    // 编辑行不能落在文字列（min-w-0 列）里，否则「保存」会离开卡片右缘
    expect(row.closest(".min-w-0")).toBeNull();
    // 输入框吃掉剩余宽度，「保存」才被顶到与「配置」同列
    expect(input.classList.contains("flex-1")).toBe(true);
    expect(input.classList.contains("min-w-0")).toBe(true);
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
    // 已配置时多出的条款提示行也必须落在同一文字列内
    expect(byExactText(card, "api.subscriptionConfigured").parentElement).toBe(
      byExactText(card, "api.subscriptionArkNote")?.parentElement,
    );
    expect(card.textContent).not.toContain("secret-key");
    const configuredButton = card.querySelector(
      'button[data-action="configure"]',
    )!;
    expect(configuredButton.classList.contains("bg-accent")).toBe(false);
    expect(configuredButton.classList.contains("border-border-muted")).toBe(
      true,
    );
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
    expect(keyInput.getAttribute("aria-label")).toBe(
      "api.subscriptionKeyLabel",
    );
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
