/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // 语义色一律包 token()。tailwind v3 对 `var(--x)` 整值不支持 /alpha：
        // withAlphaValue() → parseColor 失败 → 返回 undefined → 整条 utility 被丢弃。
        // token() 是函数色，tailwind 会把修饰符里的 alpha 交给它，由 color-mix 落地。
        // 色值真相只有 globals.css 一份，这里只做「键路径 → 变量名」映射。
        background: {
          DEFAULT: token("background"),
          secondary: token("background-secondary"),
          chrome: token("background-chrome"),
        },
        surface: {
          DEFAULT: token("surface"),
          hover: token("surface-hover"),
          active: token("surface-active"),
          muted: token("surface-muted"),
        },
        border: {
          DEFAULT: token("border"),
          muted: token("border-muted"),
          subtle: token("border-subtle"),
        },
        accent: {
          DEFAULT: token("accent"),
          hover: token("accent-hover"),
          muted: token("accent-muted"),
          foreground: token("accent-foreground"),
        },
        // ——— shadcn 契约映射（spec §5.1）———————————————————————————
        // 只收录 vendored 文件实际用到的名字（spec §5.2：枚举后定稿，不凭猜）。
        //
        // 每个 key 都指向**同名**的 --color-* 变量 —— 这不是偶然：
        // token-alpha.test.ts 锁定了「键路径 === 变量名」的不变量。
        // 那些同名变量在 globals.css 顶层 :root 里用 var() 指向本仓既有 token。
        //
        // 注意 primary 与 accent 的区别（两阶段改名，设计文档 §5.2）：
        // --color-primary 与 --color-accent 同值；变的是 **utility** accent 的
        // 含义，那是计划 7 的独立一步。
        primary: {
          DEFAULT: token("primary"),
          hover: token("primary-hover"),
          muted: token("primary-muted"),
          foreground: token("primary-foreground"),
        },
        // ⚠️ secondary 是保留给 shadcn 的**表面**名，不是文字色。
        // 它同时会生成 utility `text-secondary` —— 那个名字看上去像「次级文字」，
        // 实际渲染成表面色（深色主题下近乎不可见）且不会报错。
        // 本仓的次级文字是 `text.text.secondary` → `text-text-secondary`。
        // 两者的语义区别由 shadcn-token-mapping.test.ts 的「陷阱登记」用例钉住。
        secondary: {
          DEFAULT: token("secondary"),
          foreground: token("secondary-foreground"),
        },
        destructive: {
          DEFAULT: token("destructive"),
          foreground: token("destructive-foreground"),
        },
        foreground: token("foreground"),
        "muted-foreground": token("muted-foreground"),
        // 计划 5 追加：vendored dropdown-menu.tsx 用到的名字（枚举后定稿）
        muted: token("muted"),
        popover: {
          DEFAULT: token("popover"),
          foreground: token("popover-foreground"),
        },
        input: token("input"),
        ring: token("ring"),
        mention: token("mention"),
        // 搜索命中 / 高亮的不透明色，声明在 globals.css 顶层 :root（只一次）。
        // 取值理由与 14 个主题块下的实测对比度见
        // design-docs/2026-09-26-tailwind-token-alpha-design.md §5.2。
        highlight: token("highlight"),
        mcp: {
          DEFAULT: token("mcp"),
        },
        file: {
          media: token("file-media"),
          doc: token("file-doc"),
          code: token("file-code"),
          audio: token("file-audio"),
          neutral: token("file-neutral"),
        },
        text: {
          primary: token("text-primary"),
          secondary: token("text-secondary"),
          muted: token("text-muted"),
        },
        success: token("success"),
        "success-foreground": token("success-foreground"),
        warning: token("warning"),
        "warning-foreground": token("warning-foreground"),
        error: token("error"),
        overlay: {
          hover: token("overlay-hover"),
          press: token("overlay-press"),
          on: token("overlay-on"),
        },
        "window-close-hover": token("window-close-hover"),
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
      fontSize: {
        xs: ["0.75rem", { lineHeight: "1rem", fontWeight: "400" }], // 12px — chrome/meta
        sm: ["0.8125rem", { lineHeight: "1.25rem", fontWeight: "400" }], // 13px — compact body
        base: ["0.875rem", { lineHeight: "1.5rem", fontWeight: "400" }], // 14px — body / chat prose
        lg: ["0.9375rem", { lineHeight: "1.5rem", fontWeight: "600" }], // 15px — subtle heading
        xl: ["1rem", { lineHeight: "1.5rem", fontWeight: "600" }], // 16px — section heading
        "2xl": ["1.125rem", { lineHeight: "1.5rem", fontWeight: "600" }], // 18px — stat / major heading
      },
      boxShadow: {
        soft: "var(--shadow-soft)",
        card: "var(--shadow-card)",
        elevated: "var(--shadow-elevated)",
      },
      borderRadius: {
        control: "5px",
        container: "12px",
        lg: "8px",
        xl: "10px",
        "2xl": "14px",
        "3xl": "16px",
        "4xl": "20px",
        "5xl": "24px",
        "6xl": "28px",
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
// 等价于 rgba(var(--color-x), alpha)，color-mix 在 srgb 空间下与之一致。
// 回归测试：src/tests/renderer/token-alpha.test.ts
function token(name) {
  return ({ opacityValue }) =>
    opacityValue === undefined
      ? `var(--color-${name})`
      : `color-mix(in srgb, var(--color-${name}) calc(${opacityValue} * 100%), transparent)`;
}
