/**
 * @module renderer/components/voice-mode/star-orb
 *
 * 语音模式的主角：一个粒子球。几何、自转、呼吸与三态视觉对应设计 §3.1，
 * 参数取自 design-docs/2026-10-04-voice-only-mode-orb-prototype.html。
 *
 * 颜色是画笔值，不是主题色。谁用谁选画笔：全屏那颗永远 GLOW_BRUSH（在 `#050507`
 * 深底上发光）；后台小球按主题拿两套星点画笔（浅底深粒子、深底浅粒子）—— 见
 * design-docs/2026-10-06-mini-orb-theme-brush-design.md。
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

/** 发光档：软精灵 + 光晕 + 白热核心。 */
export interface GlowBrush {
  kind: "glow";
  palette: string[];
  haze: number;
  stars: number;
  sparks: number;
  size: number;
  composite: "lighter" | "source-over";
}

/** 星点档：锐利星点 + 核心簇 + 球界描边（浅底靠密度与描边读球）。 */
export interface StarsBrush {
  kind: "stars";
  palette: string[];
  stars: number;
  /** 核心簇粒子数：靠「这里更密」当焦点，不画发光盘。 */
  core: number;
  size: number;
  /** 球界描边。叫 edge 不叫 ring：OrbParams.ring 已经是 blocked 那圈弧。 */
  edge: string;
  composite: "lighter" | "source-over";
}

export type OrbBrush = GlowBrush | StarsBrush;

/** 全屏那颗：数值与旧的 FULL_ORB_SCALE 逐项一致（光晕/白热核心在绘制侧，不进画笔）。 */
export const GLOW_BRUSH: GlowBrush = {
  kind: "glow",
  palette: [
    "255,255,255",
    "204,224,255",
    "126,168,255",
    "172,152,255",
    "144,228,255",
  ],
  haze: 80,
  stars: 5200,
  sparks: 150,
  size: 1,
  composite: "lighter",
};

/**
 * 后台小球（40px）的两套星点画笔。
 *
 * 全屏球是「在深底上发光」：白/蓝粒子 + 光晕。搬到主题色胶囊上，浅色主题是近白底，
 * 白粒子等于隐形。所以小球不用发光画法，改用「锐利星点 + 核心簇 + 球界描边」——
 * 浅底用深色粒子、深底用浅色粒子。数值取自原型
 * `design-docs/2026-10-06-mini-orb-theme-brush/option2-v2.html` 的 ②-3 档。
 */
export const STARS_BRUSH_LIGHT: StarsBrush = {
  kind: "stars",
  palette: ["22,32,88", "43,60,150", "74,90,192", "52,40,120"],
  stars: 300,
  core: 40,
  size: 0.75,
  edge: "rgba(58,78,178,0.26)",
  composite: "source-over",
};

export const STARS_BRUSH_DARK: StarsBrush = {
  kind: "stars",
  palette: ["255,255,255", "214,230,255", "150,180,255", "176,160,255"],
  stars: 300,
  core: 40,
  size: 0.75,
  edge: "rgba(190,212,255,0.22)",
  composite: "lighter",
};

function makeSprite(rgb: string, sharp: boolean): HTMLCanvasElement {
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
  if (sharp) {
    // 星点档：中段重、边收得快 —— 浅底上要读成「点」，不是「雾」。
    grd.addColorStop(0, `rgba(${rgb},1)`);
    grd.addColorStop(0.42, `rgba(${rgb},0.72)`);
    grd.addColorStop(0.72, `rgba(${rgb},0.16)`);
    grd.addColorStop(1, `rgba(${rgb},0)`);
  } else {
    grd.addColorStop(0, `rgba(${rgb},1)`);
    grd.addColorStop(0.22, `rgba(${rgb},0.40)`);
    grd.addColorStop(0.55, `rgba(${rgb},0.09)`);
    grd.addColorStop(1, `rgba(${rgb},0)`);
  }
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

function buildParticles(brush: OrbBrush): Particle[] {
  const stars = brush.kind === "stars";
  const sprites = brush.palette.map((rgb) => makeSprite(rgb, stars));
  const pick = () => sprites[Math.floor(Math.random() * sprites.length)];
  const out: Particle[] = [];

  if (brush.kind === "glow") {
    for (let i = 0; i < brush.haze; i += 1) {
      const p = sphere(rnd(0.25, 0.95));
      out.push({
        ...p,
        size: rnd(16, 44) * brush.size,
        a: rnd(0.009, 0.024),
        sprite: pick(),
        ph: rnd(0, 6.283),
        sp: rnd(0.1, 0.34),
        haze: true,
      });
    }
  }

  // 星点档的粒子更小更实：浅底上深色粒子要读成「点」，糊了就是脏。
  const sizeRange: [number, number] = stars ? [0.7, 1.9] : [0.9, 2.5];
  const alphaRange: [number, number] = stars ? [0.42, 0.95] : [0.26, 0.8];
  for (let i = 0; i < brush.stars; i += 1) {
    const rr =
      Math.random() < 0.7 ? rnd(0.8, 1.0) : Math.pow(Math.random(), 0.5) * 0.8;
    const p = sphere(rr);
    out.push({
      ...p,
      size: rnd(sizeRange[0], sizeRange[1]) * brush.size,
      a: rnd(alphaRange[0], alphaRange[1]),
      sprite: pick(),
      ph: rnd(0, 6.283),
      sp: rnd(0.5, 2),
      haze: false,
    });
  }

  if (brush.kind === "glow") {
    for (let i = 0; i < brush.sparks; i += 1) {
      const p = sphere(rnd(0.9, 1.0));
      out.push({
        ...p,
        size: rnd(3.2, 8.5) * brush.size,
        a: rnd(0.5, 1),
        sprite: pick(),
        ph: rnd(0, 6.283),
        sp: rnd(0.8, 2.4),
        haze: false,
      });
    }
  } else {
    // 核心簇：靠「这里更密」当焦点，不画发光盘。
    for (let i = 0; i < brush.core; i += 1) {
      out.push({
        ...sphere(Math.pow(Math.random(), 1.6) * 0.42),
        size: rnd(0.9, 2.1) * brush.size,
        a: rnd(0.55, 1),
        sprite: pick(),
        ph: rnd(0, 6.283),
        sp: rnd(0.4, 1.4),
        haze: false,
      });
    }
  }
  return out;
}

export function StarOrb({
  state,
  level,
  brush,
}: {
  state: OrbState;
  level: number;
  /**
   * 谁来画：全屏传 GLOW_BRUSH，小球按主题传两套星点画笔。
   *
   * **必须是模块级常量**：它进了 useEffect 的依赖里，内联对象会让粒子每渲染一次
   * 就重建一次（300+ 颗 + 4 张精灵）。
   */
  brush: OrbBrush;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  const levelRef = useRef(level);
  stateRef.current = state;
  levelRef.current = level;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const particles = buildParticles(brush);
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
      const skin = brush;
      const lv = levelRef.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const pulse =
        stateRef.current === "speaking"
          ? 1 + lv * cfg.gain
          : 1 + Math.sin(t * 0.62) * 0.022 + lv * cfg.gain * 0.4;

      // 光晕只属于发光档：星点档靠粒子与描边读球。颜色仍取自状态（三档 hue 不同），
      // 画笔不管它 —— 写进画笔就等于把状态色定死。
      // 光晕半径必须落在画布的内切圆里。渐变一旦超出画布边界，边缘处还没走到
      // 透明，四条边就会显出一个矩形色块 —— 浅色主题下尤其刺眼（深色底上 4.7%
      // 的蓝白看不出来，白底上就是一块斑）。内切圆半径是 min(W,H)/2，所以这里
      // 直接用 0.5 倍，且**不乘 pulse**：呼吸放大同样会让它越界。
      if (skin.kind === "glow") {
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
      }
      ctx.globalCompositeOperation = brush.composite;

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

        // 0.35 设备像素的下限照原型：星点档最暗的那些粒子本来会落到亚像素，
        // 画出来过糊；发光档的粒子最小也有 0.45，这条对全屏是空操作（几何上不会命中）。
        const r = Math.max(0.35, p.size * dpr * (0.5 + depth * 0.7));
        ctx.globalAlpha = a > 1 ? 1 : a;
        ctx.drawImage(
          p.sprite,
          CX + x1 * scale - r,
          CY + y1 * scale - r,
          r * 2,
          r * 2,
        );
      }

      // 白热核心也只属于发光档：星点档的焦点是「核心簇更密」，不是一块发光盘。
      if (skin.kind === "glow") {
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
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(CX, CY, coreR, 0, 6.2832);
        ctx.fill();
      }

      // 描边不能吃上一颗粒子残留的 globalAlpha：粒子循环每颗都写 ctx.globalAlpha，
      // 不复位的话描边透明度会随最后那颗粒子的 alpha 漂移（看起来像在闪）。
      ctx.globalAlpha = 1;

      if (cfg.ring) {
        // blocked 那圈弧：原有颜色是浅色，浅底上本来就看不见 —— 星点档改用画笔的
        // 球界颜色，状态语言在小球上也保得住。
        ctx.strokeStyle =
          skin.kind === "stars" ? skin.edge : "rgba(226,238,255,0.28)";
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        const rr = R * 1.12;
        const start = t * 1.1;
        ctx.arc(CX, CY, rr, start, start + Math.PI * 1.4);
        ctx.stroke();
      }

      // 球界描边：跟着呼吸（同一个 scale），否则球胀缩时圈会错位。
      if (skin.kind === "stars") {
        ctx.strokeStyle = skin.edge;
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        ctx.arc(CX, CY, scale, 0, 6.2832);
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
  }, [brush]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="block h-full w-full"
    />
  );
}
