import { afterEach, describe, expect, it } from "vitest";
import { getLocale, setLocale, t } from "../../main/i18n";

afterEach(() => {
  // currentLocale is module-level state; reset so tests do not leak into
  // each other within the same file.
  setLocale(undefined);
});

describe("getLocale", () => {
  it("falls back to app.getLocale() before the renderer reports", () => {
    expect(getLocale()).toBe("en");
  });

  it("mirrors the renderer-reported locale", () => {
    setLocale("zh");
    expect(getLocale()).toBe("zh");
    setLocale("en");
    expect(getLocale()).toBe("en");
  });

  it("reverts to the fallback chain when reset", () => {
    setLocale("zh");
    setLocale(undefined);
    expect(getLocale()).toBe("en");
  });
});

describe("t", () => {
  it("returns the zh string after setLocale('zh')", () => {
    setLocale("zh");
    expect(t("goal.started", { objective: "do it", budget: "" })).toBe(
      "目标已启动: do it",
    );
  });

  it("returns the en string by default", () => {
    expect(t("goal.started", { objective: "do it", budget: "" })).toBe(
      "Goal started: do it",
    );
  });

  it("keeps a placeholder when the param is missing", () => {
    setLocale("zh");
    expect(t("goal.started", { objective: "x" })).toBe(
      "目标已启动: x{{budget}}",
    );
  });

  it("ignores a garbage locale and falls back to the en table", () => {
    setLocale("xx-YY" as unknown as "zh");
    expect(t("goal.started", { objective: "x", budget: "" })).toBe(
      "Goal started: x",
    );
  });

  it("falls back to the key itself for an unknown key", () => {
    expect(t("does.not.exist")).toBe("does.not.exist");
  });
});
