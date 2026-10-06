/**
 * @module renderer/components/voice-mode/star-orb
 *
 * 语音模式的主角：一个发光的粒子球。三态视觉对应设计 §3.1，
 * 参数取自 design-docs/2026-10-04-voice-only-mode-orb-prototype.html。
 *
 * 颜色是画笔值，不是主题色 —— 这个组件不跟深浅色主题走（设计 §3.1）。
 */
import { useEffect, useRef } from "react";

export type OrbState =
  | "calibrating"
  | "listening"
  | "capturing"
  | "thinking"
  | "speaking"
  | "blocked";

export interface OrbParams {
  spin: number;
  turb: number;
  bright: number;
  hue: string;
  gain: number;
  core: number;
  band: number;
  dimmed: boolean;
  ring: boolean;
}

const LISTENING: Omit<OrbParams, "dimmed" | "ring"> = {
  spin: 0.13,
  turb: 0.028,
  bright: 1.18,
  hue: "150,182,255",
  gain: 0.08,
  core: 0.24,
  band: 0.1,
};
const CAPTURING: Omit<OrbParams, "dimmed" | "ring"> = {
  spin: 0.29,
  turb: 0.072,
  bright: 1.4,
  hue: "152,228,255",
  gain: 0.22,
  core: 0.31,
  band: 0.14,
};
const SPEAKING: Omit<OrbParams, "dimmed" | "ring"> = {
  spin: 0.42,
  turb: 0.05,
  bright: 1.62,
  hue: "234,242,255",
  gain: 0.3,
  core: 0.42,
  band: 0.09,
};

const TABLE: Record<OrbState, OrbParams> = {
  calibrating: {
    ...LISTENING,
    bright: LISTENING.bright * 0.6,
    core: LISTENING.core * 0.6,
    dimmed: true,
    ring: false,
  },
  listening: { ...LISTENING, dimmed: false, ring: false },
  capturing: { ...CAPTURING, dimmed: false, ring: false },
  thinking: { ...CAPTURING, spin: 0.18, gain: 0, dimmed: false, ring: false },
  speaking: { ...SPEAKING, dimmed: false, ring: false },
  blocked: { ...LISTENING, dimmed: false, ring: true },
};

/** 纯查表，便于单测。 */
export function resolveOrbParams(state: OrbState): OrbParams {
  return TABLE[state];
}

export interface OrbScale {
  haze: number;
  stars: number;
  sparks: number;
  size: number;
}

/** 全屏档：粒子数与尺寸都不缩。 */
export const FULL_ORB_SCALE: OrbScale = {
  haze: 80,
  stars: 5200,
  sparks: 150,
  size: 1,
};

/**
 * 小球档（40px 的悬浮球）。
 *
 * 直接复用全屏参数是纯白实心盘 —— 5200 颗粒子塞进 40px；按面积等比缩比又只剩
 * 22 颗不成球。这组数字在 40px 下是「一球带星点」，取自
 * `design-docs/voice-background-preview/mini-orb.html` 的 C 档。
 *
 * 写死而不用公式：小球是固定 40px 的装饰，公式只会多一层没人用的灵活度。
 */
export const MINI_ORB_SCALE: OrbScale = {
  haze: 4,
  stars: 200,
  sparks: 6,
  size: 0.25,
};

const PALETTE: Array<[string, string]> = [
  ["255,255,255", "0.9"],
  ["204,224,255", "0.8"],
  ["126,168,255", "0.7"],
  ["172,152,255", "0.6"],
  ["144,228,255", "0.7"],
];

function makeSprite(rgb: string): HTMLCanvasElement {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grd = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  grd.addColorStop(0, `rgba(${rgb},1)`);
  grd.addColorStop(0.22, `rgba(${rgb},0.40)`);
  grd.addColorStop(0.55, `rgba(${rgb},0.09)`);
  grd.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  size: number;
  a: number;
  sprite: HTMLCanvasElement;
  ph: number;
  sp: number;
  haze: boolean;
}

function sphere(rr: number): { x: number; y: number; z: number } {
  const ct = Math.random() * 2 - 1;
  const st = Math.sqrt(Math.max(0, 1 - ct * ct));
  const ph = Math.random() * Math.PI * 2;
  return { x: rr * st * Math.cos(ph), y: rr * ct, z: rr * st * Math.sin(ph) };
}

function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function buildParticles(scale: OrbScale): Particle[] {
  const sprites = PALETTE.map(([rgb]) => makeSprite(rgb));
  const pick = () => sprites[Math.floor(Math.random() * sprites.length)];
  const out: Particle[] = [];

  for (let i = 0; i < scale.haze; i += 1) {
    const p = sphere(rnd(0.25, 0.95));
    out.push({
      ...p,
      size: rnd(16, 44) * scale.size,
      a: rnd(0.009, 0.024),
      sprite: pick(),
      ph: rnd(0, 6.283),
      sp: rnd(0.1, 0.34),
      haze: true,
    });
  }
  for (let i = 0; i < scale.stars; i += 1) {
    const rr =
      Math.random() < 0.7 ? rnd(0.8, 1.0) : Math.pow(Math.random(), 0.5) * 0.8;
    const p = sphere(rr);
    out.push({
      ...p,
      size: rnd(0.9, 2.5) * scale.size,
      a: rnd(0.26, 0.8),
      sprite: pick(),
      ph: rnd(0, 6.283),
      sp: rnd(0.5, 2),
      haze: false,
    });
  }
  for (let i = 0; i < scale.sparks; i += 1) {
    const p = sphere(rnd(0.9, 1.0));
    out.push({
      ...p,
      size: rnd(3.2, 8.5) * scale.size,
      a: rnd(0.5, 1),
      sprite: pick(),
      ph: rnd(0, 6.283),
      sp: rnd(0.8, 2.4),
      haze: false,
    });
  }
  return out;
}

export function StarOrb({
  state,
  level,
  variant = "full",
}: {
  state: OrbState;
  level: number;
  /** 小球用 "mini"：换一组粒子参数，其他都不变。 */
  variant?: "full" | "mini";
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  const levelRef = useRef(level);
  const variantRef = useRef(variant);
  stateRef.current = state;
  levelRef.current = level;
  variantRef.current = variant;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const particles = buildParticles(
      variantRef.current === "mini" ? MINI_ORB_SCALE : FULL_ORB_SCALE,
    );
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0;
    let H = 0;
    let CX = 0;
    let CY = 0;
    let R = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      W = canvas.width = Math.max(1, Math.round(rect.width * dpr));
      H = canvas.height = Math.max(1, Math.round(rect.height * dpr));
      CX = W / 2;
      CY = H / 2;
      R = Math.min(W, H) * 0.335;
    };

    let raf = 0;
    let t = 0;
    let last = 0;

    const frame = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
      last = now;
      t += dt;

      const cfg = TABLE[stateRef.current];
      const lv = levelRef.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const pulse =
        stateRef.current === "speaking"
          ? 1 + lv * cfg.gain
          : 1 + Math.sin(t * 0.62) * 0.022 + lv * cfg.gain * 0.4;

      // 光晕半径必须落在画布的内切圆里。渐变一旦超出画布边界，边缘处还没走到
      // 透明，四条边就会显出一个矩形色块 —— 浅色主题下尤其刺眼（深色底上 4.7%
      // 的蓝白看不出来，白底上就是一块斑）。内切圆半径是 min(W,H)/2，所以这里
      // 直接用 0.5 倍，且**不乘 pulse**：呼吸放大同样会让它越界。
      const halo = ctx.createRadialGradient(
        CX,
        CY,
        0,
        CX,
        CY,
        Math.min(W, H) * 0.5,
      );
      halo.addColorStop(0, `rgba(${cfg.hue},0.235)`);
      halo.addColorStop(0.32, `rgba(${cfg.hue},0.075)`);
      // 终点用同色透明，不用 rgba(0,0,0,0)：透明黑的插值会在浅色底上留下灰调。
      halo.addColorStop(1, `rgba(${cfg.hue},0)`);
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, W, H);

      ctx.globalCompositeOperation = "lighter";

      const scale = R * pulse;
      const rotY = t * cfg.spin;
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const tilt = 0.38 + Math.sin(t * 0.21) * 0.07;
      const cosX = Math.cos(tilt);
      const sinX = Math.sin(tilt);

      for (const p of particles) {
        const turb = cfg.turb * (p.haze ? 0.4 : 1);
        const x = p.x + Math.sin(t * 1.35 * p.sp + p.ph) * turb;
        const y = p.y + Math.cos(t * 1.05 * p.sp + p.ph * 1.6) * turb;
        const x1 = x * cosY - p.z * sinY;
        const z1 = x * sinY + p.z * cosY;
        const y1 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;

        const depth = (z2 + 1) / 2;
        const rn = Math.min(1, Math.sqrt(x1 * x1 + y1 * y1));
        const falloff = 1 - 0.8 * Math.pow(rn, 2.4);
        const band = 1 - cfg.band * (0.5 + 0.5 * Math.sin(x1 * 4.6 + t * 0.85));
        const a = p.a * Math.pow(depth, 1.2) * falloff * band * cfg.bright;
        if (a <= 0.004) continue;

        const r = p.size * dpr * (0.5 + depth * 0.7);
        ctx.globalAlpha = a > 1 ? 1 : a;
        ctx.drawImage(
          p.sprite,
          CX + x1 * scale - r,
          CY + y1 * scale - r,
          r * 2,
          r * 2,
        );
      }

      const coreR = scale * 0.78;
      const core = ctx.createRadialGradient(CX, CY, 0, CX, CY, coreR);
      core.addColorStop(
        0,
        `rgba(255,255,255,${(cfg.core * (0.75 + lv * 0.5)).toFixed(3)})`,
      );
      core.addColorStop(
        0.4,
        `rgba(222,236,255,${(cfg.core * 0.26).toFixed(3)})`,
      );
      core.addColorStop(1, "rgba(255,255,255,0)");
      ctx.globalAlpha = 1;
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(CX, CY, coreR, 0, 6.2832);
      ctx.fill();

      if (cfg.ring) {
        ctx.strokeStyle = "rgba(226,238,255,0.28)";
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        const rr = R * 1.12;
        const start = t * 1.1;
        ctx.arc(CX, CY, rr, start, start + Math.PI * 1.4);
        ctx.stroke();
      }

      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(frame);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="block h-full w-full"
    />
  );
}
