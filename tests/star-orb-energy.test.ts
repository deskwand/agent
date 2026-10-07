import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  orbEnergy,
  orbCoreRadiusFactor,
  resolveOrbParams,
} from "../src/renderer/components/voice-mode/star-orb";
import type { OrbState } from "../src/renderer/components/voice-mode/star-orb";

const ORB_PATH = path.resolve(
  process.cwd(),
  "src/renderer/components/voice-mode/star-orb.tsx",
);

const STATES: OrbState[] = [
  "calibrating",
  "listening",
  "capturing",
  "thinking",
  "speaking",
  "blocked",
];

describe("orbEnergy", () => {
  it("说话档只吃音量，不吃时间", () => {
    const cfg = resolveOrbParams("speaking");
    expect(orbEnergy("speaking", 0, 0.5)).toBeCloseTo(cfg.gain * 0.5, 6);
    expect(orbEnergy("speaking", 9.7, 0.5)).toBeCloseTo(
      orbEnergy("speaking", 0, 0.5),
      12,
    );
  });

  it("非说话档保留那点缓慢呼吸，并且也吃音量", () => {
    // 呼吸走 sin(t * 0.62) 那一路，在 t = (π/2) / 0.62 处到顶。**不断言 0.022 这个
    // 精确值**：它是旋钮不是契约，下一轮调参就会红。只钉住「这里有呼吸、而且很小」。
    const peak = orbEnergy("listening", Math.PI / 2 / 0.62, 0);
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(0.05);
    // 音量那一份在非说话档同样生效（系数比说话档小）。
    expect(orbEnergy("listening", 0, 1)).toBeGreaterThan(
      orbEnergy("listening", 0, 0),
    );
  });
});

describe("orbCoreRadiusFactor", () => {
  it("任何状态、任何音量下核心都在球内", () => {
    for (const state of STATES) {
      for (let level = 0; level <= 1.0001; level += 0.05) {
        for (const t of [0, 1.3, 7.7, 23.1]) {
          expect(orbCoreRadiusFactor(state, t, level)).toBeLessThan(1);
        }
      }
    }
  });

  it("说话峰值也留有余量", () => {
    expect(orbCoreRadiusFactor("speaking", 0, 1)).toBeLessThan(0.95);
  });
});

/**
 * 球界半径恒定是这个改动存在的全部理由，而它靠不住：几何在 rAF 闭包里，
 * 上面四个测试看不见。把 `const <半径> = R;` 改成 `R * (1 + energy)` 就是
 * 悄悄退回老行为，测试全绿。所以这里直接读源码守这条线。
 */
describe("球界半径恒定（源码级护栏）", () => {
  it("半径变量就是 R，且没有一处用到它的代码碰了 energy", () => {
    const source = fs.readFileSync(ORB_PATH, "utf8");

    // 名字从声明里取，不写死：重命名不该让这条护栏失效。
    const declaration = source.match(/const (\w+) = R;/);
    expect(
      declaration,
      "找不到 `const <name> = R;` —— 球界半径可能又被乘上了什么",
    ).not.toBeNull();

    const radius = declaration![1];
    const codeLines = source.split("\n").filter((line) => {
      const trimmed = line.trimStart();
      return (
        line.includes(radius) &&
        !trimmed.startsWith("*") && // 文件头注释里讲历史时提到过这个名字
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("/*")
      );
    });

    // 1 处定义 + 3 处使用（粒子 x、粒子 y、球界描边）。数目变了说明几何动过，
    // 回来看一眼那三处还在不在，别只把数字改掉。
    expect(codeLines).toHaveLength(4);
    for (const line of codeLines) {
      expect(line).not.toMatch(/energy/);
    }
  });
});
