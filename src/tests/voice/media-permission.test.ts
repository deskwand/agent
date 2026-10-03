/**
 * 媒体权限判定。
 *
 * 这是**安全边界**：自身窗口 vs 任意窗口、音频 vs 摄像头。它原本内联在
 * `index.ts` 的 `app.whenReady()` 里，import 就会启动整个应用，单测够不到 ——
 * 所以抽成 `./media-permission` 这个纯函数才有这一组测试。
 *
 * 判据是「拿不准就不放行」：错误地拒绝只让录音不可用，错误地放行是把摄像头
 * 交给渲染层里的任意代码。
 */
import { describe, expect, it } from "vitest";
import { allowMediaRequest } from "../../main/media-permission";

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
