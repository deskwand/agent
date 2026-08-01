// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import {
  ProviderBrandIcon,
  resolveProviderBrand,
} from "../../renderer/components/settings/provider-icons";

function render(el: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(el);
  });
  return container;
}

// 每个品牌取其 path 数据中唯一的特征前缀（见组件实现）
const BRAND_PATH_FRAGMENTS: Record<string, string> = {
  openai: "M22.2819 9.8211",
  anthropic: "M17.3041 3.541",
  deepseek: "M23.748 4.651",
  openrouter: "M16.778 1.844",
  gemini: "M12 2C12.7 2",
  github: "M12 .297c-6.63",
};

describe("resolveProviderBrand", () => {
  it("maps well-known providers to their own brand", () => {
    expect(resolveProviderBrand("openrouter")).toBe("openrouter");
    expect(resolveProviderBrand("anthropic")).toBe("anthropic");
    expect(resolveProviderBrand("deepseek")).toBe("deepseek");
    expect(resolveProviderBrand("openai")).toBe("openai");
    expect(resolveProviderBrand("gemini")).toBe("gemini");
    // 非 custom 时忽略 customProtocol 参数
    expect(resolveProviderBrand("openai", "anthropic")).toBe("openai");
  });

  it("maps custom providers by protocol", () => {
    expect(resolveProviderBrand("custom", "openai")).toBe("openai");
    expect(resolveProviderBrand("custom", "anthropic")).toBe("anthropic");
    expect(resolveProviderBrand("custom", "gemini")).toBe("gemini");
  });

  it("returns undefined for unmapped providers", () => {
    expect(resolveProviderBrand("custom", undefined)).toBeUndefined();
    expect(resolveProviderBrand("ollama")).toBeUndefined();
    expect(resolveProviderBrand("oauth")).toBeUndefined();
  });
});

describe("ProviderBrandIcon", () => {
  it("renders the brand svg path for each known brand", () => {
    for (const [brand, fragment] of Object.entries(BRAND_PATH_FRAGMENTS)) {
      const container = render(
        React.createElement(ProviderBrandIcon, {
          brand: brand as "openai",
        }),
      );
      const path = container.querySelector("svg path");
      expect(path?.getAttribute("d"), brand).toContain(fragment);
      container.remove();
    }
  });

  it("renders a fallback server icon for unknown brands", () => {
    const container = render(
      React.createElement(ProviderBrandIcon, { brand: "custom" }),
    );
    expect(container.querySelector(".lucide-server")).not.toBeNull();
    container.remove();
  });

  it("passes className through to the svg", () => {
    const container = render(
      React.createElement(ProviderBrandIcon, {
        brand: "openai",
        className: "h-4 w-4",
      }),
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("h-4");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    container.remove();
  });

  it("applies dark:fill-white to the github mark", () => {
    const container = render(
      React.createElement(ProviderBrandIcon, { brand: "github" }),
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("dark:fill-white");
    container.remove();
  });
});
