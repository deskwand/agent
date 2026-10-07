import type { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { BrowserViewManager } from "../main/browser/browser-view-manager";

/**
 * 面板页被外部 CDP 客户端（E2E、chrome-devtools-mcp）当草稿纸用之后的收尾行为：
 *
 *   1. `did-navigate` 只把**真实页面**记成可还原页 —— 内部 data: 页不算，否则预览失败后的
 *      "还原上一页"会把残留页拉回面板，或者让残留页顶掉用户真正在看的那一页；
 *   2. `hide()` 把内部 data: 残留页换回空白页 —— 否则关掉再打开面板还是它。
 *
 * 这两条只能用行为测：静态文本断言把守卫**反向**写（只记 data: 页、只收非 data: 页）
 * 也照样通过，拦不住人。
 */
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    session: {},
    shell: {},
    WebContentsView: class {
      webContents = Object.assign(new EventEmitter(), {
        loadURL: vi.fn(async () => {}),
        getURL: () => "",
        getTitle: () => "",
        isLoading: () => false,
        canGoBack: () => false,
        canGoForward: () => false,
        close: vi.fn(),
      });
      setVisible = vi.fn();
    },
  };
});

/** E2E 最后一条用例留下的那一页。 */
const JUNK_PAGE = "data:text/html,<button>OK</button>";
const REAL_PAGE = "https://example.com/report";

type FakeWebContents = EventEmitter & {
  loadURL: ReturnType<typeof vi.fn>;
  getURL: () => string;
};

let manager: BrowserViewManager;
let wc: FakeWebContents;
/** create() 第一枪加载的那一页就是空白页的真身，别在测试里自己编一个字符串。 */
let blankPageUrl: string;

const loadedUrls = (): string[] =>
  wc.loadURL.mock.calls.map(([url]) => String(url));

/** showStatusPage 只负责 loadURL；测试里要自己假装那一页已经在屏幕上。 */
const putStatusPageOnScreen = (): void => {
  manager.showStatusPage("正在生成预览…");
  wc.getURL = () => loadedUrls().at(-1) ?? "";
};

beforeEach(() => {
  manager = new BrowserViewManager();
  manager.create({
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  } as unknown as BrowserWindow);
  wc = manager.getWebContents() as unknown as FakeWebContents;
  blankPageUrl = loadedUrls()[0];
  manager.show();
});

describe("内部 data: 页不进可还原页", () => {
  it("真实页面会被记成可还原页", () => {
    wc.emit("did-navigate", {}, REAL_PAGE);
    putStatusPageOnScreen();

    expect(manager.restorePreviousPage()).toBe("restored");
    expect(loadedUrls().at(-1)).toBe(REAL_PAGE);
  });

  it("残留 data: 页不会顶掉用户那一页", () => {
    wc.emit("did-navigate", {}, REAL_PAGE);
    wc.emit("did-navigate", {}, JUNK_PAGE);
    putStatusPageOnScreen();

    expect(manager.restorePreviousPage()).toBe("restored");
    expect(loadedUrls().at(-1)).toBe(REAL_PAGE);
  });

  it("只有残留 data: 页时没有可还原的页面", () => {
    wc.emit("did-navigate", {}, JUNK_PAGE);
    putStatusPageOnScreen();

    // 调用方据此显示错误页，而不是把这页垃圾拉回来
    expect(manager.restorePreviousPage()).toBe("no-previous");
  });
});

describe("关面板时收掉内部残留页", () => {
  it("残留 data: 页换回空白页", () => {
    wc.getURL = () => JUNK_PAGE;
    const before = loadedUrls().length;

    manager.hide();

    expect(loadedUrls().slice(before)).toEqual([blankPageUrl]);
    // 页面换了，可见状态也得跟上：地址栏显示 about:blank 而不是那串残留
    expect(manager.getStatus().url).toBe("about:blank");
  });

  it("真实页面不会被收掉", () => {
    wc.emit("did-navigate", {}, REAL_PAGE);
    wc.getURL = () => REAL_PAGE;
    const before = loadedUrls().length;

    manager.hide();

    expect(loadedUrls().slice(before)).toEqual([]);
  });

  it("本来就停在空白页时不重载", () => {
    wc.getURL = () => blankPageUrl;
    const before = loadedUrls().length;

    manager.hide();

    expect(loadedUrls().slice(before)).toEqual([]);
  });
});

describe("回到空白页后状态自洽", () => {
  it("换底色会重绘空白页（_isOnBlankPage 双向派生）", () => {
    wc.emit("did-navigate", {}, REAL_PAGE);
    wc.emit("did-navigate", {}, blankPageUrl);
    const before = loadedUrls().length;

    // 同主题、只换底色：只有"确实停在空白页"才该重绘
    manager.setTheme("light", "#101010");

    const added = loadedUrls().slice(before);
    expect(added).toHaveLength(1);
    expect(added[0].startsWith("data:text/html;base64,")).toBe(true);
  });

  it("还在真实页面上时不重绘", () => {
    wc.emit("did-navigate", {}, REAL_PAGE);
    const before = loadedUrls().length;

    manager.setTheme("light", "#101010");

    expect(loadedUrls().slice(before)).toEqual([]);
  });
});
