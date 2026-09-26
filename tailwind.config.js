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
      },
    },
  },
  plugins: [],
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
