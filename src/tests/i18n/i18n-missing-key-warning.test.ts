// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("i18n missing key 运行时告警", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    window.localStorage.setItem("i18nextLng", "zh");
    window.electronAPI = { send: vi.fn() } as never;
  });

  it("两边语言都没有的 key 会告警并原样返回", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const i18n = (await import("../../renderer/i18n/config")).default;

    expect(i18n.t("definitely.missing.key")).toBe("definitely.missing.key");
    expect(warn.mock.calls.flat().join(" ")).toContain(
      "definitely.missing.key",
    );
  });

  it("已存在的 key 与复数变体不告警", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const i18n = (await import("../../renderer/i18n/config")).default;

    expect(i18n.resolvedLanguage).toBe("zh");
    expect(i18n.t("common.save")).not.toBe("common.save");
    expect(i18n.t("sidebar.relativeTime.day", { count: 3 })).not.toBe(
      "sidebar.relativeTime.day",
    );
    expect(warn).not.toHaveBeenCalled();
  });

  // i18next 在 usedDefault 分支（key 两边都缺、调用方传了 defaultValue）也会调用本
  // handler，且用返回值替换已解析出的 default。这里靠 defaultValue 当哨兵/兜底文案
  // 的调用点（ApiDiagnosticsPanel 的 fix、AgentRunContainer 的 status）不能被它改掉。
  it("调用方传了 defaultValue 时保留 defaultValue", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const i18n = (await import("../../renderer/i18n/config")).default;

    expect(i18n.t("definitely.missing.key", "Fallback text")).toBe(
      "Fallback text",
    );
    expect(i18n.t("definitely.missing.key", { defaultValue: "" })).toBe("");
    expect(warn).toHaveBeenCalled();
  });
});
