import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/**
 * 打进安装包但运行时用不到的包。判定依据见
 * design-docs/2026-10-07-installer-size-trim-plan.md「背景与证据」A/B/C：
 * 主进程 bundle、dist-mcp bundle、src/main 里对它们的 require/import 计数全为 0。
 *
 * katex 故意不在此列表：rehype-katex 与 micromark-extension-math（经 remark-math）都声明
 * dependencies.katex，只移我们这份它仍会被拉回闭包（已实测）。同理仍随包发布的还有
 * react-i18next / react-markdown / react-window / zustand / rehype-katex / remark-* /
 * rehype-sanitize / i18next / ansi-to-html —— 本轮的取舍是不动这批渲染层尾巴。
 * **后果**：主进程若哪天要 import 它们，Vite 必须把它内联进 dist-electron，不能加进
 * vite.config.ts 的 external —— external 会在运行时 MODULE_NOT_FOUND（包里已经没有）。
 * 详见计划文末「取舍」。
 */
const MUST_NOT_SHIP = [
  'canvas', // 40.28 MiB（全在 app.asar.unpacked）：只有 linkedom / jsdom 的可选探测会用它
  'jsdom', // 3.01 MiB：readability 已改用 linkedom，只剩 src/tests 用
  'lucide-react', // 6.84 MiB：渲染层图标，已由 Vite 打进 dist/assets
  'highlight.js', // 腾出的是我们那份 11.11.1（5.15 MiB）；整包 6.76 → 1.61 MiB
  'react', // 0.30 MiB
  'react-dom', // 4.30 MiB
];

/**
 * 必须留在 devDependencies 的：渲染层由 Vite 打包，jsdom 是测试环境。
 *
 * `canvas` 刻意不在这里：`src/` 与 `tests/` 都不 require 它，它只是 jsdom 的
 * **optional** peer（peerDependenciesMeta.optional）和 linkedom 未声明的
 * `try { require('canvas') }` 探测。所以日后清理 dev 依赖时可以直接删掉它 ——
 * 打包产物本来就没有它，会落到 linkedom 自带的 canvas shim（已冒烟验证）。
 * 它的 lock 条目带 `dev: true`，与 react / react-dom 的情况不同（见下）。
 */
const MUST_BE_INSTALLED = ['jsdom', 'lucide-react', 'highlight.js', 'react', 'react-dom'];

/**
 * react / react-dom 是 react-i18next、react-window、zustand、react-markdown 等**生产**依赖的
 * peer，因此 npm 不会给它们在 package-lock.json 里的条目打 `dev: true`（`scheduler` /
 * `loose-envify` 同理）。这不影响打包：electron-builder 的 node-dep-tree 不看
 * peerDependencies，实测这四个都会离开生产闭包。**别为了"让 lock 一致"把它们从
 * devDependencies 里删掉** —— `@vitejs/plugin-react` 与渲染层构建需要它们。
 */
describe('installer dependency classification', () => {
  it.each(MUST_NOT_SHIP)('%s must not be a production dependency', (name) => {
    expect(pkg.dependencies ?? {}).not.toHaveProperty(name);
  });

  it.each(MUST_BE_INSTALLED)('%s must stay installed for dev and build', (name) => {
    expect(pkg.devDependencies ?? {}).toHaveProperty(name);
  });
});
