// 强调色维度的**接线**不变量：属性怎么挂、配置怎么读、面板怎么给。
//
// 用源码断言（与 theme-overlay-tokens.test.ts 的"主题类与预设属性都挂在 documentElement 上"
// 同一做法）——这些是"少一行就静默失效"的接线，值得钉住，但不值得为它们起一套渲染 harness。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

const app = read("src/renderer/App.tsx");
const store = read("src/renderer/store/index.ts");
const useIPC = read("src/renderer/hooks/useIPC.ts");
const settings = read("src/renderer/components/settings/SettingsGeneral.tsx");
const configStore = read("src/main/config/config-store.ts");
const mainIndex = read("src/main/index.ts");

describe("强调色接线", () => {
  it("App 挂属性：default 时移除、其余时候设置", () => {
    expect(app).toMatch(/removeAttribute\("data-theme-accent"\)/);
    expect(app).toMatch(/setAttribute\(\s*"data-theme-accent"/);
    // 依赖数组里必须有 themeAccent，否则切了强调色不重挂属性
    expect(app).toMatch(
      /\[effectiveTheme, settings\.themePreset, settings\.themeAccent\]/,
    );
  });

  it("store 与主进程都用共享默认值（老配置缺字段时不乱猜）", () => {
    expect(store).toMatch(/themeAccent: DEFAULT_THEME_ACCENT/);
    expect(configStore).toMatch(/themeAccent: DEFAULT_THEME_ACCENT/);
    // 主进程的持久化与投影两条路径都要带上
    expect(configStore).toMatch(/themeAccent: stored\.themeAccent/);
    expect(configStore).toMatch(/isThemeAccent\(updates\.themeAccent\)/);
  });

  it("读配置时归一（旧配置没有这个字段 ⇒ default）", () => {
    expect(useIPC).toMatch(
      /themeAccent: normalizeThemeAccent\(config\.themeAccent\)/,
    );
  });

  it("IPC 用共享白名单校验（硬编码名单会漏掉新主题）", () => {
    expect(mainIndex).toMatch(
      /VALID_THEME_ACCENTS\.includes\(event\.payload\.themeAccent/,
    );
    expect(mainIndex).toMatch(
      /VALID_THEME_PRESETS\.includes\(event\.payload\.themePreset/,
    );
  });

  it("设置面板：选项从共享白名单派生，且写回 settings.themeAccent", () => {
    expect(settings).toMatch(/VALID_THEME_ACCENTS\.map\(/);
    expect(settings).toMatch(/label: t\(\s*`general\.themeAccent/);
    expect(settings).toMatch(
      /onChange=\{\(next\) => updateSettings\(\{ themeAccent: next \}\)\}/,
    );
  });

  it("没人直接用 vendored Button 的 link 变体（它写的是裸 text-primary）", () => {
    // vendored `ui/button.tsx` 的 link 变体是 `text-primary` —— 强调色上线后那是**填充**色，
    // 官方暗色对暗底只有 1.98–2.81、亮色 lime/neutral 只有 1.53，链接会读不清。
    // 按本仓约定不改 vendored 文件，所以这里守住"没有调用点踩它"：
    // 需要链接外观就用 app-button（它的 link 变体已换成 --primary-text）。
    const offenders: string[] = [];
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === "ui" ? [] : walk(p);
        return /\.tsx$/.test(e.name) ? [p] : [];
      });
    for (const file of walk(path.join(root, "src/renderer"))) {
      const text = fs.readFileSync(file, "utf8");
      if (!/variant="link"/.test(text)) continue;
      // 用 app-button 的可以（已迁到 --primary-text），用 vendored 的不行
      const usesVendored = /from "(\.\.\/)+ui\/button"/.test(text);
      if (usesVendored) offenders.push(path.relative(root, file));
    }
    expect(
      offenders,
      `这些文件直接用 vendored Button 的 link 变体（文字色不可读）：\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("i18n：18 个标签在两种语言里都齐", () => {
    for (const lang of ["zh", "en"]) {
      const dict = JSON.parse(
        read(`src/renderer/i18n/locales/${lang}.json`),
      ) as { general: Record<string, string> };
      const keys = Object.keys(dict.general).filter((k) =>
        k.startsWith("themeAccent"),
      );
      // themeAccent + 18 个选项名
      expect(keys.length, `${lang} 的 accent 标签数`).toBe(19);
      expect(dict.general.themeAccent, `${lang} 缺 themeAccent`).toBeTruthy();
    }
  });

  it("全仓没有把 text-primary 当文字用的残留（-foreground / -text 除外）", () => {
    // 为什么把计划里的那条一次性 grep 提成常设断言：`text-primary` 是**填充**色，
    // 叠了强调色之后当文字只有 1.53（neutral/lime 亮）—— 链接、状态点、行内 chip 都会读不清。
    // class-compile.test.ts 只能证明“能编译”，它对一个能解析但角色错的 token 同样绿；
    // 而目视清单已经连续两轮未执行，所以把“文字侧已迁到 primary-text”钉下来。
    //
    // 口径（与计划的 grep 逐字一致）：`text-primary` 后面不能跟字母或连字符 ——
    // `text-primary-foreground`（填充面上的字）与 `text-primary-text` 都不算。
    const bare = /(^|[^a-z-])text-primary([^a-z-]|$)/;
    const offenders: string[] = [];
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === "ui" ? [] : walk(p);
        return /\.(tsx?|css)$/.test(e.name) ? [p] : [];
      });
    for (const file of walk(path.join(root, "src/renderer"))) {
      const text = fs.readFileSync(file, "utf8");
      text.split("\n").forEach((line, i) => {
        if (bare.test(line)) {
          offenders.push(`${path.relative(root, file)}:${i + 1}`);
        }
      });
    }
    expect(
      offenders,
      `以下位置把 text-primary 当文字用（填充色，叠强调色后读不清；改用 text-primary-text）：\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
