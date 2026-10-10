/**
 * @module renderer/components/voice-mode/star-orb
 *
 * 语音模式的主角：一个粒子球。几何、自转、呼吸与三态视觉对应设计 §3.1，
 * 参数取自 design-docs/2026-10-04-voice-only-mode-orb-prototype.html。
 *
 * **球界半径恒定**：原型把音量驱动的伸缩乘进了 `scale`，球会跟着音量胀缩；这里
 * 刻意不乘 —— 半径恒为 `R`，能量只走亮度 / 湍流 / 核心，见 `orbEnergy`。
 * 对比预览：design-docs/2026-10-07-star-orb-fixed-radius-preview.html。
 *
 * 颜色是画笔值，不是主题色。谁用谁选画笔：全屏那颗按主题拿 `GLOW_BALL_LIGHT` /
 * `GLOW_BALL_DARK`（有边界的球，舞台跟随主题）；后台小球与顶栏图标按主题拿两套
 * 星点画笔（浅底深粒子、深底浅粒子）—— 见
 * design-docs/2026-10-06-mini-orb-theme-brush-design.md 与
 * design-docs/2026-10-10-voice-light-theme-design.md。
 */
import { useEffect, useRef, useState } from "react";

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
  /** 有边界的球：给了就把球内的一切裁进半径 R 的圆里画；不给 = 满屏画法。 */
  ball?: GlowBallSkin;
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

/**
 * 注意：`STARS_BRUSH_*` 这对常量是给 **40px 那档**（旧的后台小球尺寸）调的。它们从
 * 2026-10-08 起一度没有生产使用者（唯一那颗迷你球搬进 header 后改成了静态状态点）；
 * 2026-10-09 起由语音小球卡面里那颗 62px 的球使用。
 * 保留 `brush.kind === "stars"` 分支是有意的：浮层那颗球用的是 `GLOW_BALL_*`，而 stars
 * 那一支是完整的绘制实现，删它要动 500 多行的球体核心，收益只是少几十行不可达代码。
 *
 * 顶栏图标那颗 16px 球**不用这一对**：见下面的 `STARS_BRUSH_ICON_*`。
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

/**
 * 图标档（顶栏那颗 24px 画布的球）：为小尺寸**单独调**的一支，不是 40px 那支的缩放。
 *
 * 为什么必须另调：球界半径 `R = min(W,H) * 0.335`，24px 画布下只有 8px；而粒子尺寸
 * 按画布 px 算、不随画布缩 —— 300 颗星塞进 16px 的球就是一坨噪点，反倒是那圈 `edge`
 * 描边成了最扎眼的元素。砍到 64 颗、粒子放大到 1.5×、描边压到 0.18 之后，16px 下
 * 读得出来是「一小团星星」。实测探针：`design-docs/star-orb-size/`。
 *
 * 顺带：78 颗/帧 vs 40px 档的 340 颗/帧 —— 常驻顶栏也便宜。
 */
export const STARS_BRUSH_ICON_LIGHT: StarsBrush = {
  kind: "stars",
  palette: ["22,32,88", "43,60,150", "74,90,192", "52,40,120"],
  stars: 64,
  core: 14,
  size: 1.5,
  edge: "rgba(58,78,178,0.18)",
  composite: "source-over",
};

export const STARS_BRUSH_ICON_DARK: StarsBrush = {
  kind: "stars",
  palette: ["255,255,255", "214,230,255", "150,180,255", "176,160,255"],
  stars: 64,
  core: 14,
  size: 1.5,
  edge: "rgba(190,212,255,0.16)",
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
   * 谁来画：全屏按主题传 `GLOW_BALL_*`（有边界的球），小球按主题传两套星点画笔。
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

  // 偏好是**活的**：CSS 的媒体查询会瞬间重算，canvas 得自己订阅，否则用户在系统设置里
  // 中途一改，两条路就走出不一样的行为（顶栏那颗球会继续转）。初始值惰性求值。
  const [still, setStill] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setStill(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

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
      // 静止档下重画这一帧就够了，循环压根没起
      if (still) frame(performance.now());
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
      // 上一帧的粒子循环把 globalAlpha 逐个写过，这里复位：落影与底色不吃残留
      ctx.globalAlpha = 1;

      // 能量不进几何：半径恒定，球界才不会跟着音量一大一小地跳。
      const energy = orbEnergy(stateRef.current, t, lv);

      // 有边界的球（浅色主题下的浮层）：落影 → 球体底色 → 把球内的一切裁进半径 R 的圆。
      // 顺序是规格：底色在 clip 之前，hairline 与 blocked 弧在 restore 之后（球外）。
      // 没有 ball 的画笔（顶栏那颗图标球、旧的全屏画法）这一段整个跳过。
      const ball = skin.kind === "glow" ? skin.ball : undefined;
      if (ball) {
        if (ball.shadow) {
          const sy = CY + R * BALL_SHADOW_OFFSET;
          const shadow = ctx.createRadialGradient(
            CX,
            sy,
            R * BALL_SHADOW_INNER,
            CX,
            sy,
            R * BALL_SHADOW_OUTER,
          );
          shadow.addColorStop(0, `rgba(${ball.shadow.rgb},${ball.shadow.a})`);
          shadow.addColorStop(1, `rgba(${ball.shadow.rgb},0)`);
          ctx.fillStyle = shadow;
          ctx.beginPath();
          ctx.arc(CX, sy, R * BALL_SHADOW_OUTER, 0, 6.2832);
          ctx.fill();
        }
        ctx.fillStyle = ball.body;
        ctx.beginPath();
        ctx.arc(CX, CY, R, 0, 6.2832);
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.arc(CX, CY, R, 0, 6.2832);
        ctx.clip();
      }

      // 光晕只属于发光档：星点档靠粒子与描边读球。颜色仍取自状态（三档 hue 不同），
      // 画笔不管它 —— 写进画笔就等于把状态色定死。
      // 光晕半径必须落在画布的内切圆里。渐变一旦超出画布边界，边缘处还没走到
      // 透明，四条边就会显出一个矩形色块 —— 浅色主题下尤其刺眼（深色底上 4.7%
      // 的蓝白看不出来，白底上就是一块斑）。内切圆半径是 min(W,H)/2，所以这里
      // 直接用 0.5 倍。光晕本来就不进几何，半径恒定之后它更没越界的余地了。
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

      // 半径恒定，不再被音量驱动地伸缩。粒子坐标、白热核心、小球那条球界描边
      // 全用这一个变量——三处都不许再乘任何随音量变的东西。
      const scale = R;
      const rotY = t * cfg.spin;
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const tilt = 0.38 + Math.sin(t * 0.21) * 0.07;
      const cosX = Math.cos(tilt);
      const sinX = Math.sin(tilt);

      for (const p of particles) {
        // 出口二：能量不推球界，改推球内的游动——星点更躁，轮廓不动。
        const turb = cfg.turb * (p.haze ? 0.4 : 1) * (1 + energy * 2);
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
        // 出口一：亮度。alpha 下面会被 globalAlpha 钳到 1，说话档的 bright 本来
        // 就是 1.62，所以这条路一部分是白给的——读得出动静的是湍流和核心。
        const a =
          p.a *
          Math.pow(depth, 1.2) *
          falloff *
          band *
          cfg.bright *
          (1 + energy);
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
        // 出口三：核心在球内涨缩。倍数由 orbCoreRadiusFactor 保证 < 1，碰不到球界描边。
        const coreR = R * orbCoreRadiusFactor(stateRef.current, t, lv);
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

      // 球体裁剪到这里就关掉：球界与 blocked 弧都画在球外（半径 1.12R）。放在 ring 之前
      // 是承重的 —— 弧画在 clip 里会被裁成零像素，blocked 态于是与 listening 像素一样。
      // restore 同时把合成模式退回 source-over（save 是在设 brush.composite 之前做的），
      // 浅色那条弧才不会被 lighter 叠成纯白。
      if (ball) ctx.restore();

      if (cfg.ring) {
        // blocked 那圈弧：原有颜色是浅色，浅底上本来就看不见 —— 星点档改用画笔的
        // 球界颜色，给了一颗球（全屏那颗）就用球规格里的弧色，状态语言都保得住。
        ctx.strokeStyle = ball
          ? ball.arc
          : skin.kind === "stars"
            ? skin.edge
            : "rgba(226,238,255,0.28)";
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        const rr = R * 1.12;
        const start = t * 1.1;
        ctx.arc(CX, CY, rr, start, start + Math.PI * 1.4);
        ctx.stroke();
      }

      // 球界描边：半径恒定，圈也就不会跟球错位（以前它得跟着乘同一个变量）。
      if (skin.kind === "stars") {
        ctx.strokeStyle = skin.edge;
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        ctx.arc(CX, CY, scale, 0, 6.2832);
        ctx.stroke();
      }

      ctx.globalCompositeOperation = "source-over";

      // 球界 hairline：必须在 restore 之后 —— 压在裁剪圆上的描边会被裁成半条。
      if (ball) {
        ctx.strokeStyle = ball.edge;
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        ctx.arc(CX, CY, R, 0, 6.2832);
        ctx.stroke();
      }
      // 减少动态时不排下一帧：整个效果只有 resize() 触发的那一帧
      if (!still) raf = requestAnimationFrame(frame);
    };

    resize();
    window.addEventListener("resize", resize);
    if (!still) raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [brush, still]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="block h-full w-full"
    />
  );
}

// —— 能量从几何里出走后，只走三个出口 ——
//
// 球界半径恒定是硬约束（半径一涨一缩，整块布局看着就在跳）。能量于是只走三处，
// 系数按 2026-10-07 的对比预览定：粒子亮度 ×(1 + energy)、球内湍流 ×(1 + 2 ×
// energy)、白热核心半径 ×(1 + 0.6 × energy)。观感要调就调这三个数，别去动几何。

/**
 * 能量标量（旧代码里「伸缩倍数 − 1」那一份，渲染循环里叫 `energy`）。
 *
 * 说话档只吃音量，不吃时间——球面不再呼吸；其余状态保留那点缓慢的
 * `sin(t * 0.62) * 0.022`，它现在只推核心，不推球界。
 *
 * 不夹 `level`：源头 `utils/voice/mic-capture.ts` 已经夹到 `[0, 1]`，越界既不可达
 * 也无害——CSS 颜色对越界 alpha 是夹取不是判无效（`rgba(…,3.25)` 就是纯白）。
 */
export function orbEnergy(state: OrbState, t: number, level: number): number {
  const cfg = TABLE[state];
  return state === "speaking"
    ? level * cfg.gain
    : Math.sin(t * 0.62) * 0.022 + level * cfg.gain * 0.4;
}

/**
 * 白热核心半径占球界 `R` 的比例：基准 0.78，随能量最多再涨 0.6 倍。
 *
 * 契约：**在 `level ∈ [0, 1]` 下恒 `< 1`**——核心只属于球内，碰不到那圈球界描边。
 * 说话峰值（level = 1、gain = 0.3）时是 0.92，留了余量。`level` 的上游
 * `utils/voice/mic-capture.ts` 就把它夹在 `[0,1]`；要越过 1.28 核心才会压到描边上，
 * 而那条路不可达。0.78 与 0.6 只在这里出现一次。
 */
export function orbCoreRadiusFactor(
  state: OrbState,
  t: number,
  level: number,
): number {
  return 0.78 * (1 + orbEnergy(state, t, level) * 0.6);
}

/**
 * 系统是否要求减少动态。
 *
 * `globals.css` 末尾那条 `prefers-reduced-motion` 覆盖**只管得住 CSS 动画**，canvas 得
 * 自己问 —— 不问的话，常驻顶栏会留下一个永远在跑的绘制循环。
 *
 * 每次调用现问一次媒体查询。`StarOrb` 另订阅了它的 `change` 事件 —— 用户在系统设置里
 * 中途改动也会立刻生效，与 CSS 那条覆盖的行为保持一致。
 * （`sidebar-disclosure-motion.tsx` 里有同一份判断，各留本地：那是 UI 组件的实现细节，
 * 不值得为三行代码开一个共享模块。）
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * 有边界的球（浅色主题下的全屏那颗）：球体底色 + 球界 hairline + blocked 弧 + 可选的落影。
 *
 * 为什么是画笔上的规格而不是组件的 prop：`star-orb.tsx` 的规矩是「颜色是画笔值，
 * 不是主题色；谁用谁选画笔」。球体裁剪要的两件事（球体色、球界色）恰好都是颜色，
 * 由消费者按主题挑两支持久常量，组件自己不认识主题。
 *
 * 验收标准（`star-orb-brush.test.ts` 里三条对比度钉子）：浅底上球体是一块实心暗物
 * （≥ 15:1）；hairline 看得见但不成为实体（1.05–1.6:1）；blocked 弧白底上真看得见
 * （≥ 3:1）。数值改动必须同时改测试里的阈值。
 */
export interface GlowBallSkin {
  /** 球体底色。 */
  body: string;
  /** 球界那一圈 hairline。 */
  edge: string;
  /** blocked 那圈弧（画在球外，浅底上要看得见）。 */
  arc: string;
  /**
   * 落影。给了才画 —— 深底上看不见，画了是纯浪费。
   *
   * `rgb` 写三元组（与 `palette` / `cfg.hue` 同一写法），`a` 是不透明度：渐变的末端
   * 要用**同色透明**（`rgba(0,0,0,0)` 的插值会在浅色底上留下一层灰）。
   */
  shadow?: { rgb: string; a: number };
}

/** 全屏那颗的浅色版：白底上一颗带落影的深色球。 */
export const GLOW_BALL_LIGHT: GlowBrush = {
  ...GLOW_BRUSH,
  ball: {
    body: "#050507",
    edge: "rgba(15,20,45,0.10)",
    arc: "rgba(58,78,178,0.85)",
    shadow: { rgb: "28,36,84", a: 0.18 },
  },
};

/** 全屏那颗的深色版：舞台与球体同是近黑，靠那圈 10% 亮边读球界；深底上不画落影。 */
export const GLOW_BALL_DARK: GlowBrush = {
  ...GLOW_BRUSH,
  ball: {
    body: "#050507",
    edge: "rgba(190,212,255,0.10)",
    arc: "rgba(226,238,255,0.28)",
  },
};

// 落影的几何：中心下移一点、内圈落在球内、外圈比球大 22%。写在这里而不是画笔里 ——
// 画笔只管颜色，与 TABLE / 画笔表的既有分工一致。
// （常量声明在文件尾部、引用它的绘制代码在文件中部：模块级 const 在模块求值时就已
// 初始化，渲染发生在之后，没有 TDZ 问题。）
const BALL_SHADOW_OFFSET = 0.04;
const BALL_SHADOW_INNER = 0.9;
const BALL_SHADOW_OUTER = 1.22;
