// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectCards } from "../src/renderer/components/welcome/connect-cards";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("welcome connect cards", () => {
  let root: Root;
  const container = document.createElement("div");

  // container 从未挂到 document 上，只能从 container 里查（同 tests/coding-subscription-cards.test.ts）。
  const byTestId = (id: string) =>
    container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  afterEach(() => {
    if (root) act(() => root.unmount());
    container.replaceChildren();
  });

  const render = async (props: Partial<Parameters<typeof ConnectCards>[0]>) => {
    const onOpenCloud = props.onOpenCloud ?? vi.fn();
    const onOpenApiKey = props.onOpenApiKey ?? vi.fn();
    const onConnectOAuth = props.onConnectOAuth ?? vi.fn(async () => {});
    const onConnectSubscription =
      props.onConnectSubscription ?? vi.fn(async () => {});
    root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(ConnectCards, {
          onOpenCloud,
          onOpenApiKey,
          onConnectOAuth,
          onConnectSubscription,
        }),
      ),
    );
    return { onOpenCloud, onOpenApiKey, onConnectOAuth, onConnectSubscription };
  };

  it("shows three cards collapsed, with the subscription list hidden", async () => {
    await render({});

    expect(byTestId("connect-card-cloud")).not.toBeNull();
    expect(byTestId("connect-card-subscription")).not.toBeNull();
    expect(byTestId("connect-card-api-key")).not.toBeNull();
    expect(byTestId("connect-row-anthropic")).toBeNull();
  });

  it("expands six rows with the four oauth rows first", async () => {
    await render({});

    await act(async () => byTestId("connect-card-subscription")!.click());

    const ids = [...container.querySelectorAll("[data-testid^='connect-row-']")]
      .map((el) => el.getAttribute("data-testid"))
      .filter((id) => !id!.includes("error"));
    expect(ids).toEqual([
      "connect-row-anthropic",
      "connect-row-openai-codex",
      "connect-row-github-copilot",
      "connect-row-openrouter",
      "connect-row-custom:subscription-bailian-coding",
      "connect-row-custom:subscription-ark-coding",
    ]);
  });

  it("opens api settings from the third card", async () => {
    const { onOpenApiKey } = await render({});

    await act(async () => byTestId("connect-card-api-key")!.click());

    expect(onOpenApiKey).toHaveBeenCalledTimes(1);
  });

  it("opens the cloud login from the first card", async () => {
    const { onOpenCloud } = await render({});

    await act(async () => byTestId("connect-card-cloud")!.click());

    expect(onOpenCloud).toHaveBeenCalledTimes(1);
  });

  it("marks the clicked oauth row as pending and disables its siblings", async () => {
    let release: () => void = () => {};
    const onConnectOAuth = vi.fn(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    await render({ onConnectOAuth });
    await act(async () => byTestId("connect-card-subscription")!.click());

    await act(async () => byTestId("connect-row-anthropic")!.click());

    expect(onConnectOAuth).toHaveBeenCalledWith("anthropic", "Anthropic");
    expect(byTestId("connect-row-anthropic")!.textContent).toContain(
      "connect.loggingIn",
    );
    expect(
      (byTestId("connect-row-openai-codex") as HTMLButtonElement).disabled,
    ).toBe(true);

    await act(async () => {
      release();
    });
  });

  it("prints the failure under the row it belongs to", async () => {
    const onConnectOAuth = vi.fn(async () => {
      throw new Error("authorization timed out");
    });
    await render({ onConnectOAuth });
    await act(async () => byTestId("connect-card-subscription")!.click());

    await act(async () => byTestId("connect-row-anthropic")!.click());

    expect(byTestId("connect-row-error-anthropic")!.textContent).toContain(
      "authorization timed out",
    );
    expect(
      (byTestId("connect-row-openai-codex") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("refuses to submit an empty subscription key", async () => {
    const onConnectSubscription = vi.fn(async () => {});
    await render({ onConnectSubscription });
    await act(async () => byTestId("connect-card-subscription")!.click());
    await act(async () =>
      byTestId("connect-row-custom:subscription-bailian-coding")!.click(),
    );

    await act(async () => {
      byTestId("connect-key-save-custom:subscription-bailian-coding")!.click();
    });

    expect(onConnectSubscription).not.toHaveBeenCalled();
    expect(
      byTestId("connect-row-error-custom:subscription-bailian-coding")!
        .textContent,
    ).toContain("connect.keyRequired");
  });

  it("collects a subscription key inline and hands it to the callback", async () => {
    const onConnectSubscription = vi.fn(async () => {});
    await render({ onConnectSubscription });
    await act(async () => byTestId("connect-card-subscription")!.click());

    await act(async () =>
      byTestId("connect-row-custom:subscription-bailian-coding")!.click(),
    );

    const input = byTestId(
      "connect-key-input-custom:subscription-bailian-coding",
    ) as HTMLInputElement;
    expect(input).not.toBeNull();

    await act(async () => {
      // React 会接管 value 的 setter：直接赋值会被它的 tracker 当成「没变」而跳过
      // onChange，必须先拿原生 setter 再派发 input 事件
      // （见 tests/coding-subscription-cards.test.ts）。
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "sk-sp-abc");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      byTestId("connect-key-save-custom:subscription-bailian-coding")!.click();
    });

    expect(onConnectSubscription).toHaveBeenCalledWith(
      "custom:subscription-bailian-coding",
      "sk-sp-abc",
    );
  });
});
