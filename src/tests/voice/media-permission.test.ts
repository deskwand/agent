/**
 * 权限判定（媒体 + 剪贴板）。
 *
 * 这是**安全边界**：自身窗口 vs 任意窗口、音频 vs 摄像头、媒体 vs 剪贴板。它原本
 * 内联在 `index.ts` 的 `app.whenReady()` 里，import 就会启动整个应用，单测够不到 ——
 * 所以抽成 `./media-permission` 这个纯函数才有这一组测试。
 *
 * 判据是「拿不准就不放行」：错误地拒绝只让录音不可用，错误地放行是把摄像头
 * 交给渲染层里的任意代码。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  allowClipboardRequest,
  allowMediaRequest,
  allowPermissionRequest,
} from "../../main/media-permission";

const ownWindowAudio = {
  isOwnWindow: true,
  permission: "media",
  mediaTypes: ["audio"],
};

describe("allowMediaRequest", () => {
  it("放行自身窗口的纯音频请求", () => {
    expect(allowMediaRequest(ownWindowAudio)).toBe(true);
  });

  it("别人的窗口一律拒", () => {
    expect(allowMediaRequest({ ...ownWindowAudio, isOwnWindow: false })).toBe(
      false,
    );
  });

  it("非 media 权限一律拒", () => {
    for (const permission of ["camera", "notifications", "geolocation", ""]) {
      expect(allowMediaRequest({ ...ownWindowAudio, permission })).toBe(false);
    }
  });

  it("摄像头一律拒 —— 这个应用没有开摄像头的场景", () => {
    expect(
      allowMediaRequest({ ...ownWindowAudio, mediaTypes: ["video"] }),
    ).toBe(false);
  });

  it("音视频混合也拒（只要带了 video 就不放行）", () => {
    expect(
      allowMediaRequest({ ...ownWindowAudio, mediaTypes: ["audio", "video"] }),
    ).toBe(false);
  });

  it("mediaTypes 缺失时拒 —— 拿不准就不放行", () => {
    // Electron 只在 media 权限上带 mediaTypes；跨版本拿不到的话，
    // 当成「可以放行」会把摄像头一起放出去。
    expect(
      allowMediaRequest({ ...ownWindowAudio, mediaTypes: undefined }),
    ).toBe(false);
  });

  it("mediaTypes 是空数组时拒", () => {
    expect(allowMediaRequest({ ...ownWindowAudio, mediaTypes: [] })).toBe(
      false,
    );
  });

  it("mediaTypes 不是数组时拒（形状变了也不能放行）", () => {
    for (const mediaTypes of ["audio", { 0: "audio" }, 1, null]) {
      expect(allowMediaRequest({ ...ownWindowAudio, mediaTypes })).toBe(false);
    }
  });
});

// 回归背景：permission handler 一装上就替代了 Electron 的默认策略（默认是放行），
// 而剪贴板请求也走这个 handler。只放行 media 时，渲染层所有 navigator.clipboard
// 调用都被判死，表现是消息复制、代码块复制、图片预览复制全部「点了没反应」。

/**
 * 这个 handler 内联在 `index.ts` 里，而那个文件 import 就会启动应用 —— 单测够不到
 * 它的行为，所以只能对源码文本立一道护栏（房子写法同
 * src/tests/renderer/menu-token-adoption.test.ts）。
 *
 * 它锁的是「handler 接的是哪个判定函数」。上面那些用例只证明判定函数写得对，
 * 证明不了 handler 真的调了它 —— 把 handler 改回 `allowMediaRequest`，
 * 那批用例一条都不会红，而这正是已经发生过一次的回退（语音功能那次加 handler）。
 *
 * 这是最好努力的守卫，不是证明：挡住的是「整块换回旧函数」，挡不住「另起一个
 * 等价但名字不同的判定」。
 */
const INDEX_SOURCE = readFileSync(
  join(process.cwd(), "src/main/index.ts"),
  "utf8",
);

describe("index.ts 的 permission handler 接线", () => {
  it("从 ./media-permission 引入组合判定 allowPermissionRequest", () => {
    expect(INDEX_SOURCE).toMatch(
      /import\s*\{[^}]*allowPermissionRequest[^}]*\}\s*from\s*"\.\/media-permission"/,
    );
  });

  it("handler 调的是组合判定", () => {
    expect(INDEX_SOURCE).toContain("allowPermissionRequest({");
  });

  it("handler 没有改回只放行媒体的旧判定", () => {
    // 辨认「调用」而不是「提到名字」：回归形态是 `allowMediaRequest({`。
    // 注释里写这个名字不算回退，所以不能直接断言文件里没有这个词。
    expect(INDEX_SOURCE).not.toContain("allowMediaRequest({");
  });
});
const ownWindowClipboard = {
  isOwnWindow: true,
  permission: "clipboard-read",
};

describe("allowClipboardRequest", () => {
  it("放行自身窗口的 clipboard-read（35 上读和写都报这个名）", () => {
    expect(allowClipboardRequest(ownWindowClipboard)).toBe(true);
  });

  it("放行自身窗口的 clipboard-sanitized-write（别的版本上写请求的名字）", () => {
    expect(
      allowClipboardRequest({
        ...ownWindowClipboard,
        permission: "clipboard-sanitized-write",
      }),
    ).toBe(true);
  });

  it("别人的窗口一律拒", () => {
    for (const permission of ["clipboard-read", "clipboard-sanitized-write"]) {
      expect(
        allowClipboardRequest({
          ...ownWindowClipboard,
          permission,
          isOwnWindow: false,
        }),
      ).toBe(false);
    }
  });

  it("非剪贴板权限一律拒", () => {
    for (const permission of [
      "media",
      "notifications",
      "geolocation",
      "display-capture",
      "openExternal",
      "",
      "clipboard",
    ]) {
      expect(allowClipboardRequest({ ...ownWindowClipboard, permission })).toBe(
        false,
      );
    }
  });
});

describe("allowPermissionRequest", () => {
  it("剪贴板走剪贴板那一条", () => {
    expect(allowPermissionRequest(ownWindowClipboard)).toBe(true);
  });

  it("音频走媒体那一条", () => {
    expect(allowPermissionRequest(ownWindowAudio)).toBe(true);
  });

  it("两条都不匹配的一律拒 —— 放行面不因新增剪贴板而变大", () => {
    for (const permission of [
      "notifications",
      "geolocation",
      "display-capture",
      "midi",
      "usb",
      "openExternal",
      "",
    ]) {
      expect(allowPermissionRequest({ isOwnWindow: true, permission })).toBe(
        false,
      );
    }
  });

  it("别人的窗口连剪贴板也不放行", () => {
    expect(
      allowPermissionRequest({ ...ownWindowClipboard, isOwnWindow: false }),
    ).toBe(false);
  });

  it("摄像头仍拒 —— 剪贴板分支不能把它捎带放行", () => {
    expect(
      allowPermissionRequest({
        ...ownWindowAudio,
        mediaTypes: ["audio", "video"],
      }),
    ).toBe(false);
  });
});
