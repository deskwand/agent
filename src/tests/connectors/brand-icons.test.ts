import { describe, expect, it } from "vitest";
import { serviceIconFor } from "../../renderer/components/connectors/brand-icons";

describe("serviceIconFor", () => {
  it("认得出目录里的厂商，且大小写不敏感", () => {
    for (const n of ["notion", "Notion", "NOTION"]) {
      expect(serviceIconFor(n)).toMatchObject({ kind: "brand" });
    }
    expect(serviceIconFor("linear")).toMatchObject({ kind: "brand" });
    expect(serviceIconFor("sentry")).toMatchObject({ kind: "brand" });
    expect(serviceIconFor("stripe")).toMatchObject({ kind: "brand" });
    expect(serviceIconFor("atlassian")).toMatchObject({ kind: "brand" });
  });

  it("认得出非目录条目 Chrome（用户 mcp.json 里的旧残留）", () => {
    expect(serviceIconFor("Chrome")).toMatchObject({ kind: "brand" });
  });

  it("认得出我们自己的服务，且它没有厂商 url", () => {
    expect(serviceIconFor("GUI_Operate")).toEqual({ kind: "firstParty" });
  });

  it("认不出的回落 undefined（调用方画首字母）", () => {
    for (const n of ["my-server", "", "  ", "testn"]) {
      expect(serviceIconFor(n)).toBeUndefined();
    }
  });

  it("原型链上的名字不算厂商", () => {
    // 靠 `BRAND_ICONS[key]` 的真值判断会在这里取到 Object / Object.prototype 这种
    // 非字符串值，于是用户把 server 起成 `constructor` 就画出一张坏图
    for (const n of [
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
    ]) {
      expect(serviceIconFor(n)).toBeUndefined();
    }
  });

  it("每家的图各是各的，没有串行或重复", () => {
    // 表是手写的，最容易出的错是 slug 串行或复制粘贴重复 —— 只看 kind 发现不了。
    // 图标内联后仍带着各自的 <title>，所以这里按 title 认人。
    const expected: Array<[string, string]> = [
      ["notion", "Notion"],
      ["linear", "Linear"],
      ["sentry", "Sentry"],
      ["stripe", "Stripe"],
      ["atlassian", "Atlassian"],
      ["chrome", "Google Chrome"],
    ];
    const urls = expected.map(([name]) => {
      const icon = serviceIconFor(name);
      if (icon?.kind !== "brand") throw new Error(`${name} 没认出来`);
      return decodeURIComponent(icon.url);
    });
    expected.forEach(([, title], i) => {
      expect(urls[i]).toContain(`<title>${title}</title>`);
    });
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("前后空白不影响判定", () => {
    expect(serviceIconFor(" notion ")).toMatchObject({ kind: "brand" });
  });
});
