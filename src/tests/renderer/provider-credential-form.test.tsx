// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import i18n from "../../renderer/i18n/config";
import { ProviderCredentialForm } from "../../renderer/components/settings/api/provider-credential-form";
import type { ProviderCatalogEntry } from "../../renderer/components/settings/provider-catalog";
import { API_PROVIDER_PRESETS } from "../../shared/api-model-presets";

const deepseek: ProviderCatalogEntry = {
  kind: "provider",
  id: "deepseek",
  keyUrl: "https://platform.deepseek.com/api_keys",
};
const custom: ProviderCatalogEntry = { kind: "provider", id: "custom" };

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

function render(
  overrides: Partial<React.ComponentProps<typeof ProviderCredentialForm>> = {},
) {
  const props = {
    entry: deepseek,
    presets: API_PROVIDER_PRESETS,
    submitLabel: "Add",
    busy: false,
    onSubmit: vi.fn(),
    ...overrides,
  };
  act(() => root.render(<ProviderCredentialForm {...props} />));
  return props;
}

function byTestId<T extends HTMLElement>(id: string): T | null {
  return container.querySelector<T>(`[data-testid="${id}"]`);
}

function typeInto(id: string, value: string) {
  const input = byTestId<HTMLInputElement>(id)!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("凭证表单", () => {
  it("API Key 为空时主按钮禁用", () => {
    render();
    expect(byTestId<HTMLButtonElement>("credential-submit")!.disabled).toBe(
      true,
    );
  });

  it("填了 key 后主按钮可用，提交把值交回", () => {
    const props = render();
    typeInto("credential-api-key", "sk-live");
    const submit = byTestId<HTMLButtonElement>("credential-submit")!;
    expect(submit.disabled).toBe(false);
    act(() => submit.click());
    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sk-live" }),
    );
  });

  it("厂商条目给出「获取 Key ↗」链接", () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      openExternal,
    };
    render();
    act(() => byTestId<HTMLButtonElement>("credential-key-url")!.click());
    expect(openExternal).toHaveBeenCalledWith(
      "https://platform.deepseek.com/api_keys",
    );
  });

  it("预设条目的 Base URL 只读，自定义条目可编辑", () => {
    render();
    expect(byTestId<HTMLInputElement>("credential-base-url")!.readOnly).toBe(
      true,
    );

    act(() => root.unmount());
    root = createRoot(container);
    render({ entry: custom });
    expect(byTestId<HTMLInputElement>("credential-base-url")!.readOnly).toBe(
      false,
    );
  });

  it("编辑态 key 默认打码只读，点「更换」后可输入", () => {
    render({ initial: { apiKey: "sk-old", maskedKey: "sk-••••••old" } });
    const key = byTestId<HTMLInputElement>("credential-api-key")!;
    expect(key.readOnly).toBe(true);
    expect(key.value).toContain("••••");
    act(() => byTestId<HTMLButtonElement>("credential-replace-key")!.click());
    expect(byTestId<HTMLInputElement>("credential-api-key")!.readOnly).toBe(
      false,
    );
  });

  it("busy 时主按钮显示连接中且禁点", () => {
    render({ busy: true, initial: { apiKey: "sk-old" } });
    const submit = byTestId<HTMLButtonElement>("credential-submit")!;
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toContain(i18n.t("api.connecting"));
  });

  it("fieldError 时字段下出现错误文案，且主按钮仍可点（便于重试）", () => {
    render({ fieldError: "apiKey" });
    expect(container.textContent).toContain(i18n.t("api.enterApiKey"));
  });

  it("secondaryAction 渲染成次要按钮并回调", () => {
    const onClick = vi.fn();
    render({
      initial: { apiKey: "sk-old" },
      secondaryAction: { label: "Save anyway", onClick },
    });
    act(() => byTestId<HTMLButtonElement>("credential-secondary")!.click());
    expect(onClick).toHaveBeenCalled();
  });
});
