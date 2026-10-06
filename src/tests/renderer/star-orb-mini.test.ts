import { describe, expect, it } from "vitest";
import {
  FULL_ORB_SCALE,
  MINI_ORB_SCALE,
} from "../../renderer/components/voice-mode/star-orb";

describe("星空球的尺寸档", () => {
  it("全屏档不变：5200 颗星、尺寸不缩", () => {
    expect(FULL_ORB_SCALE).toEqual({
      haze: 80,
      stars: 5200,
      sparks: 150,
      size: 1,
    });
  });

  it("小球档取 C 档：约 200 颗、尺寸 ×0.25", () => {
    expect(MINI_ORB_SCALE).toEqual({
      haze: 4,
      stars: 200,
      sparks: 6,
      size: 0.25,
    });
  });
});
