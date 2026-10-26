/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      // 键路径 === 变量名（都无前缀）——由 token-alpha.test.ts 锁定。
      // 官方 31 个变量：一份官方主题贴进来就齐活。
      colors: {
        background: token("background"),
        foreground: token("foreground"),
        card: { DEFAULT: token("card"), foreground: token("card-foreground") },
        popover: {
          DEFAULT: token("popover"),
          foreground: token("popover-foreground"),
        },
        primary: {
          DEFAULT: token("primary"),
          foreground: token("primary-foreground"),
        },
        secondary: {
          DEFAULT: token("secondary"),
          foreground: token("secondary-foreground"),
        },
        muted: {
          DEFAULT: token("muted"),
          foreground: token("muted-foreground"),
        },
        accent: {
          DEFAULT: token("accent"),
          foreground: token("accent-foreground"),
        },
        // 强调色的"文字档"：官方 accent 的暗色 primary 对暗底只有 1.98–2.81，不能当文字用。
        // 变量在 globals.css 的固定语义层声明一次（一条 color-mix 公式），不逐块写。
        "primary-text": token("primary-text"),
        destructive: {
          DEFAULT: token("destructive"),
          // ⚠️ 官方 31 里没有 destructive-foreground：本仓固定语义层提供它
          //（vendored ui/button.tsx 的 destructive 变体写死了这个类名）。
          foreground: token("destructive-foreground"),
        },
        border: token("border"),
        input: token("input"),
        ring: token("ring"),
        "chart-1": token("chart-1"),
        "chart-2": token("chart-2"),
        "chart-3": token("chart-3"),
        "chart-4": token("chart-4"),
        "chart-5": token("chart-5"),
        sidebar: {
          DEFAULT: token("sidebar"),
          foreground: token("sidebar-foreground"),
          primary: token("sidebar-primary"),
          "primary-foreground": token("sidebar-primary-foreground"),
          accent: token("sidebar-accent"),
          "accent-foreground": token("sidebar-accent-foreground"),
          border: token("sidebar-border"),
          ring: token("sidebar-ring"),
        },
        // ——— 固定语义层：与主题无关，不随 palette 变（只分明暗）———————
        success: {
          DEFAULT: token("success"),
          foreground: token("success-foreground"),
        },
        warning: {
          DEFAULT: token("warning"),
          foreground: token("warning-foreground"),
        },
        "file-media": token("file-media"),
        "file-doc": token("file-doc"),
        "file-code": token("file-code"),
        "file-audio": token("file-audio"),
        "file-neutral": token("file-neutral"),
        "app-chrome": token("app-chrome"),
        "window-close-hover": token("window-close-hover"),
        // 悬浮 / 选中表面（固定语义层派生，见 globals.css 顶部那段注释）：
        // 键路径 === 变量名，由 token-alpha.test.ts 锁定。
        "hover-surface": token("hover-surface"),
        "selected-surface": token("selected-surface"),
      },
      fontFamily: {
        sans: [
          "Geist Variable",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "PingFang SC",
          "Microsoft YaHei",
          "Noto Sans CJK SC",
          "Noto Sans SC",
          "Source Han Sans SC",
          "WenQuanYi Micro Hei",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "Geist Mono Variable",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      // 官方（= Tailwind 默认）尺度。fontWeight 400 是本仓护栏（官方无等价物），保留：
      // 它让 text-* 在继承到非 400 的容器里仍然回到正文字重；fontWeight 工具类排在其后，
      // `text-sm font-medium` 依旧生效。
      fontSize: {
        xs: ["0.75rem", { lineHeight: "1rem", fontWeight: "400" }], // 12px
        sm: ["0.875rem", { lineHeight: "1.25rem", fontWeight: "400" }], // 14px
        base: ["1rem", { lineHeight: "1.5rem", fontWeight: "400" }], // 16px
        lg: ["1.125rem", { lineHeight: "1.75rem", fontWeight: "600" }], // 18px
        xl: ["1.25rem", { lineHeight: "1.75rem", fontWeight: "600" }], // 20px
        "2xl": ["1.5rem", { lineHeight: "2rem", fontWeight: "600" }], // 24px
      },
      boxShadow: {
        soft: "var(--shadow-soft)",
        card: "var(--shadow-card)",
        elevated: "var(--shadow-elevated)",
      },
      // 官方 shadcn 公式：sm/md/lg/xl/2xl/3xl/4xl = --radius 的 0.6/0.8/1/1.4/1.8/2.2/2.6 倍；
      // 5xl/6xl 官方没有，按同一步长（+0.4）外推。3xl 全仓零引用，但按外科原则保留。
      borderRadius: {
        sm: "calc(var(--radius) * 0.6)",
        md: "calc(var(--radius) * 0.8)",
        lg: "calc(var(--radius) * 1)",
        xl: "calc(var(--radius) * 1.4)",
        "2xl": "calc(var(--radius) * 1.8)",
        "3xl": "calc(var(--radius) * 2.2)",
        "4xl": "calc(var(--radius) * 2.6)",
        "5xl": "calc(var(--radius) * 3)",
        "6xl": "calc(var(--radius) * 3.4)",
        // 本仓语义档：控件 6px、容器 12px（后者恰好与官方 1.2× 相同）
        control: "calc(var(--radius) * 0.6)",
        container: "calc(var(--radius) * 1.2)",
      },
      backgroundImage: {
        "grid-pattern": `url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23d4d2cc' fill-opacity='0.4'%3E%3Cpath d='M0 0h1v40H0V0zm39 0h1v40h-1V0z'/%3E%3Cpath d='M0 0h40v1H0V0zm0 39h40v1H0v-1z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        "spin-slow": "spin 2s linear infinite",
        expand: "expand 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        "voice-polish-ring": "voicePolishRing 1.6s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        expand: {
          "0%": { opacity: "0", maxHeight: "0" },
          "100%": { opacity: "1", maxHeight: "500px" },
        },
        voicePolishRing: {
          "0%,100%": { opacity: "0.25" },
          "50%": { opacity: "1" },
        },
      },
    },
  },
  // tailwindcss-animate 是 shadcn 组件的 v3 伴随插件。
  //
  // 为什么需要它：vendored 的 dialog / alert-dialog / sheet 写的是
  // `data-[state=open]:animate-in … fade-in-0 zoom-in-95 slide-in-from-left-1/2`，
  // 这一族 utility 全部由该插件提供。不装的话弹窗会硬闪出来（无进出场动画），
  // 而不只是「没动画」—— 那些类名会变成死类，token-alpha.test.ts 的全仓
  // 死类不变量会直接报出来。
  //
  // 与本仓自带动画不冲突：本仓的是 `animate-fade-in` / `animate-slide-up`
  //（tailwind.config.js 的 animation/keyframes）与 globals.css 里的
  // `.animate-toast-in-*` / `.animate-menu-in-*`，名字与本插件的
  // `animate-in` / `fade-in-0` / `slide-in-from-*` 家族无重叠。
  plugins: [require("tailwindcss-animate")],
};

// 语义色 → 可加透明度修饰符的 tailwind 颜色。
//
// 返回的是函数色：tailwind v3 的 withAlphaValue() 对函数会调用
// color({ opacityValue })，把修饰符里的 alpha 原样交进来——
//   无修饰符时是 "var(--tw-bg-opacity, 1)"（保留 bg-opacity 链路）
//   有修饰符时是 "0.4"
// 两种情况都走 color-mix，因此色值真相仍然只有 globals.css 一份。
// 等价于 rgba(var(--x), alpha)，color-mix 在 srgb 空间下与之一致。
// 回归测试：src/tests/renderer/token-alpha.test.ts
function token(name) {
  return ({ opacityValue }) =>
    opacityValue === undefined
      ? `var(--${name})`
      : `color-mix(in srgb, var(--${name}) calc(${opacityValue} * 100%), transparent)`;
}
