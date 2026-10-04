import { describe, it, expect } from "vitest";
import { MAIL_PROVIDERS, findMailProvider } from "../../shared/mail-providers";
import zh from "../../renderer/i18n/locales/zh.json";
import en from "../../renderer/i18n/locales/en.json";

/** 读 i18n 的点路径。查不到返回 undefined —— 缺 key 就是失败，不做静默回退。 */
function at(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

describe("mail providers", () => {
  it("covers the eight providers the design names", () => {
    expect(MAIL_PROVIDERS.map((p) => p.id)).toEqual([
      "qq",
      "netease-163",
      "netease-126",
      "exmail",
      "aliyun",
      "gmail",
      "icloud",
      "custom",
    ]);
  });

  it("gives every provider a short mark and i18n keys present in both locales", () => {
    // 计划里这里写的是 <= 2，但计划自己的预设表给 163 / 126 的 mark 就是三位数字，
    // 设计 §3.6 也逐条列了 `163` / `126`。两处只有一处能让：保留用户可见的品牌标记，
    // 上界放到 3。见实现报告里的偏差说明。
    for (const p of MAIL_PROVIDERS) {
      expect(p.mark.length).toBeGreaterThan(0);
      expect(p.mark.length).toBeLessThanOrEqual(3);
      for (const locale of [zh, en]) {
        expect(at(locale, p.nameKey), `${p.id} nameKey`).toBeTruthy();
        expect(
          at(locale, p.credentialLabelKey),
          `${p.id} credentialLabelKey`,
        ).toBeTruthy();
        expect(at(locale, p.hintKey), `${p.id} hintKey`).toBeTruthy();
      }
    }
  });

  it("declares imap/smtp endpoints for every provider except custom", () => {
    for (const p of MAIL_PROVIDERS) {
      if (p.id === "custom") {
        expect(p.imap).toBeUndefined();
        expect(p.smtp).toBeUndefined();
        continue;
      }
      expect(p.imap, `${p.id} imap`).toBeDefined();
      expect(p.smtp, `${p.id} smtp`).toBeDefined();
    }
  });

  it("writes secure explicitly per row — never inferred from the port", () => {
    // vendor 的 normalizeAccountConfig 用 `port === 465` 推 smtp.secure。
    // iCloud 是 587 + STARTTLS，所以两条都不能靠推断。
    const icloud = findMailProvider("icloud");
    expect(icloud?.smtp).toEqual({
      host: "smtp.mail.me.com",
      port: 587,
      secure: false,
    });
    expect(icloud?.imap).toEqual({
      host: "imap.mail.me.com",
      port: 993,
      secure: true,
    });
  });

  it("marks only iCloud as needing the local-part IMAP username", () => {
    const withFlag = MAIL_PROVIDERS.filter((p) => p.tryLocalPartUser === true);
    expect(withFlag.map((p) => p.id)).toEqual(["icloud"]);
  });

  it("points every provider at an https console page", () => {
    for (const p of MAIL_PROVIDERS) {
      expect(p.consoleUrl, `${p.id} consoleUrl`).toMatch(/^https:\/\//);
    }
  });

  it("findMailProvider returns undefined for an unknown id", () => {
    expect(findMailProvider("nope")).toBeUndefined();
    expect(findMailProvider("qq")?.mark).toBe("QQ");
  });
});
