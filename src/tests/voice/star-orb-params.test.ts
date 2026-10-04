import { describe, it, expect } from "vitest";
import { resolveOrbParams } from "../../renderer/components/voice-mode/star-orb";

describe("resolveOrbParams", () => {
  it("calibrating is the listening look, dimmed", () => {
    const listening = resolveOrbParams("listening");
    const calibrating = resolveOrbParams("calibrating");
    expect(calibrating.spin).toBe(listening.spin);
    expect(calibrating.bright).toBeLessThan(listening.bright);
    expect(calibrating.dimmed).toBe(true);
  });

  it("speaking is the brightest and fastest", () => {
    const speaking = resolveOrbParams("speaking");
    expect(speaking.bright).toBeGreaterThan(
      resolveOrbParams("capturing").bright,
    );
    expect(speaking.spin).toBeGreaterThan(resolveOrbParams("listening").spin);
    expect(speaking.gain).toBeGreaterThan(resolveOrbParams("listening").gain);
  });

  it("thinking keeps capturing curvature but does not react to volume", () => {
    const thinking = resolveOrbParams("thinking");
    expect(thinking.gain).toBe(0);
    expect(thinking.spin).toBeLessThan(resolveOrbParams("capturing").spin);
    expect(thinking.hue).toBe(resolveOrbParams("capturing").hue);
  });

  it("blocked shows the ring", () => {
    expect(resolveOrbParams("blocked").ring).toBe(true);
    expect(resolveOrbParams("listening").ring).toBe(false);
  });
});
