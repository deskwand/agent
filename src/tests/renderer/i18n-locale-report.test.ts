// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The renderer is the single source of truth for language: the whole fix
 * depends on it mirroring the locale into the main process. Nothing else
 * covers this path, so a renamed event or a report firing before i18next
 * settles would regress silently.
 */

type SentEvent = { type: string; payload?: { locale?: string } };

describe("renderer reports its locale to the main process", () => {
  let send: ReturnType<typeof vi.fn>;
  let changeLanguage: (lng: string) => Promise<unknown>;

  beforeEach(async () => {
    vi.resetModules();
    send = vi.fn();
    window.electronAPI = { send } as never;
    window.localStorage.setItem("i18nextLng", "en");

    const i18n = (await import("../../renderer/i18n/config")).default;
    changeLanguage = (lng: string) => i18n.changeLanguage(lng);
  });

  afterEach(() => {
    delete (window as { electronAPI?: unknown }).electronAPI;
    window.localStorage.clear();
  });

  const locales = () =>
    send.mock.calls
      .map(([event]) => (event as SentEvent).payload?.locale)
      .filter(Boolean);

  it("reports the detected locale on import", () => {
    expect(send).toHaveBeenCalledWith({
      type: "i18n.setLocale",
      payload: { locale: "en" },
    });
  });

  it("reports zh after switching language", async () => {
    await changeLanguage("zh");
    expect(locales().at(-1)).toBe("zh");
  });

  it("reports en after switching back", async () => {
    await changeLanguage("zh");
    await changeLanguage("en");
    expect(locales().at(-1)).toBe("en");
  });

  it("treats a regional zh locale as zh", async () => {
    await changeLanguage("zh-CN");
    expect(locales().at(-1)).toBe("zh");
  });
});
