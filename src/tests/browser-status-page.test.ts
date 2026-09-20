import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { displayUrlFor } from "../main/browser/browser-view-manager";

/**
 * 状态页（"正在生成预览…" / 错误页）是主进程构造的 `data:text/html;base64,…`。
 * 若原样暴露给渲染层，地址栏会显示一大串 base64，"用外部浏览器打开"按钮也会被点亮。
 * 所以显示层把它归一化成 `about:blank`——与既有空白页同一个约定。
 */
describe("displayUrlFor", () => {
  it("normalises the blank page", () => {
    expect(displayUrlFor("data:text/html;base64,AAA", true, null)).toBe(
      "about:blank",
    );
  });

  it("normalises the status page", () => {
    expect(
      displayUrlFor(
        "data:text/html;base64,STATUS",
        false,
        "data:text/html;base64,STATUS",
      ),
    ).toBe("about:blank");
  });

  it("keeps a real page untouched", () => {
    expect(
      displayUrlFor(
        "file:///tmp/preview.html",
        false,
        "data:text/html;base64,STATUS",
      ),
    ).toBe("file:///tmp/preview.html");
  });

  it("does not treat a stale status url as the status page", () => {
    // 状态页字段已清空时，任何 data: 页都按真实页面看待
    expect(displayUrlFor("data:text/html;base64,OTHER", false, null)).toBe(
      "data:text/html;base64,OTHER",
    );
  });
});

describe("showStatusPage 的静态约束", () => {
  const src = () =>
    readFileSync(
      resolve(__dirname, "../main/browser/browser-view-manager.ts"),
      "utf8",
    );

  it("exists and loads the page into the existing webContents", () => {
    const text = src();
    const i = text.indexOf("showStatusPage(");
    expect(i).toBeGreaterThan(-1);
    expect(text.slice(i, i + 900)).toContain("loadURL(");
  });

  it("never calls show() — visibility is owned by the renderer", () => {
    const text = src();
    const start = text.indexOf("  showStatusPage(");
    const next = text.indexOf("  private _buildStatusPageUrl(");
    expect(start).toBeGreaterThan(-1);
    expect(next).toBeGreaterThan(start);
    // 边界用紧邻的私有方法名（两个都是本任务新写的，稳定）。
    // 不要用 "\n  /**" 这类模糊标记——那样切片可能越过方法体，守卫会为错误的理由失败。
    const body = text.slice(start, next);
    expect(body).not.toContain("this.show()");
    // 真正的失效模式其实是 `if (!this.visible) return;`——只查 show() 会漏掉它
    expect(body).not.toContain("this.visible");
  });

  it("clears the status url when navigating to real content", () => {
    const text = src();
    const i = text.indexOf("  navigate(url: string): void {");
    expect(i).toBeGreaterThan(-1);
    expect(text.slice(i, i + 900)).toContain("this._statusPageDataUrl = null");
  });
});
