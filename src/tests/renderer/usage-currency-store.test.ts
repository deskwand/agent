// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 用量页货币切片的行为测试（不靠源码字符串）：
 * - 默认值跟随语言（含**首次启动**：store 模块比 i18n.init 先求值，i18nextLng 还不存在）
 * - 切换货币必须清掉旧币种的汇率（防旧 rate 换算错新币种）
 */
async function freshUseAppStore() {
  vi.resetModules();
  const mod = await import("../../renderer/store/index");
  return mod.useAppStore;
}

function stubNavigatorLanguage(value: string): void {
  Object.defineProperty(navigator, "language", {
    value,
    configurable: true,
  });
}

describe("usage currency store slice", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to CNY when the language detector's cache is Chinese", async () => {
    localStorage.setItem("i18nextLng", "zh-CN");
    stubNavigatorLanguage("en-US");

    const useAppStore = await freshUseAppStore();

    expect(useAppStore.getState().currency).toBe("CNY");
  });

  it("defaults to CNY from the platform language on a first launch", async () => {
    // 首次启动：main.tsx 先 import App（拉到 store），后 import i18n/config，
    // 所以 store 求值时 i18nextLng 还没被 LanguageDetector 写进去
    stubNavigatorLanguage("zh-CN");

    const useAppStore = await freshUseAppStore();

    expect(useAppStore.getState().currency).toBe("CNY");
  });

  it("defaults to USD otherwise", async () => {
    stubNavigatorLanguage("en-US");

    const useAppStore = await freshUseAppStore();

    expect(useAppStore.getState().currency).toBe("USD");
  });

  it("persists the choice and clears the previous currency's rate", async () => {
    const useAppStore = await freshUseAppStore();
    useAppStore.getState().setCurrencyRate(7.1);

    useAppStore.getState().setCurrency("EUR");

    expect(useAppStore.getState()).toMatchObject({
      currency: "EUR",
      currencyRate: null,
    });
    expect(localStorage.getItem("deskwand.usageCurrency")).toBe("EUR");
  });
});
