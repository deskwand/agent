import { describe, expect, it } from "vitest";
import { mailProviderIconUrl } from "../../renderer/components/connectors/mail-provider-icons";
import { MAIL_PROVIDERS } from "../../shared/mail-providers";
import type { MailProviderId } from "../../shared/mail-providers";

describe("mailProviderIconUrl", () => {
  it("有图标的是这四家", () => {
    const withIcon = MAIL_PROVIDERS.filter((p) =>
      mailProviderIconUrl(p.id),
    ).map((p) => p.id);
    expect(withIcon).toEqual(["qq", "aliyun", "gmail", "icloud"]);
  });

  it("四张图各是各的，没有串行或重复", () => {
    // 表是手写的，最容易出的错是 slug 串行或复制粘贴重复 —— 只看「有值」发现不了。
    // 图标内联后仍带着各自的 <title>，所以这里按 title 认人（同 brand-icons.test.ts）。
    const expected: Array<[MailProviderId, string]> = [
      ["qq", "QQ"],
      ["aliyun", "Alibaba Cloud"],
      ["gmail", "Gmail"],
      ["icloud", "iCloud"],
    ];
    const svgs = expected.map(([id, title]) => {
      const url = mailProviderIconUrl(id);
      if (!url) throw new Error(`${id} 没图标`);
      const svg = decodeURIComponent(url);
      expect(svg).toContain(`<title>${title}</title>`);
      return svg;
    });
    expect(new Set(svgs).size).toBe(svgs.length);
  });

  it("没有图标的那几家返回 undefined（调用方画字母标记）", () => {
    const without: MailProviderId[] = [
      "netease-163",
      "netease-126",
      "exmail",
      "custom",
    ];
    for (const id of without) {
      expect(mailProviderIconUrl(id), id).toBeUndefined();
    }
  });

  it("非邮箱条目（没有 providerId）返回 undefined", () => {
    expect(mailProviderIconUrl(undefined)).toBeUndefined();
  });

  it("原型链上的名字不算服务商", () => {
    // `providerId` 是跨 JSON 边界来的：`mail.json` 手改或损坏时，落在这里的是任意字符串，
    // 而类型里的 `MailProviderId` 只是断言不是校验（见 account-store.ts）。
    // 只用真值判断会取到 `constructor` / `__proto__` 这类**非字符串**值，
    // 卡片会当真 url 画出一张坏图（brand-icons.tsx 同样防着这件事）。
    for (const id of ["constructor", "__proto__", "toString", "nope"]) {
      expect(mailProviderIconUrl(id as MailProviderId), id).toBeUndefined();
    }
  });
});
