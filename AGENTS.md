# AGENTS.md

本文档用于指导 AI Agent 在本仓库中安全、规范、高效地工作。

---

## 1. 项目概述

- **项目名**: omagt（Oh My Agent）— 开源 AI 智能助手桌面应用
- **类型**: Electron 桌面应用（主进程）+ React + Tailwind 渲染层
- **语言**: TypeScript（strict 模式），Node.js ≥ 22
- **包管理器**: npm
- **许可证**: MIT
- **目标平台**: Windows (.exe) + macOS (.dmg)，通过 electron-builder 打包

---

## 2. 技术栈与常用命令

### 核心技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | Electron 35 |
| UI | React 18 + Tailwind CSS 3 + Vite 7 |
| 状态管理 | zustand |
| 国际化 | i18next（zh / en） |
| 本地数据库 | better-sqlite3 |
| AI SDK | @anthropic-ai/sdk / openai / @google/genai / @pi-ai/client |
| 协议 | @modelcontextprotocol/sdk（MCP） |
| 远程控制 | @larksuite/node-sdk / @slack/bolt |
| 测试 | Vitest 4 |
| 代码规范 | ESLint + Prettier + lint-staged + husky |
| 提交规范 | commitlint（Conventional Commits） |

### 常用命令

```bash
npm run dev          # 开发模式（Vite + Electron）
npm run dev:mac      # macOS 开发模式
npm run dev:win      # Windows 开发模式
npm run build        # 生产构建
npm run build:mac    # 构建 macOS .dmg
npm run build:win    # 构建 Windows .exe
npm test             # 运行 Vitest 测试
npm run lint         # ESLint 检查
npm run lint:fix     # ESLint 自动修复
npm run format       # Prettier 格式化
npm run format:check # Prettier 格式检查
```

---

## 3. 架构与约定

### 目录结构

```
src/
├── main/       # Electron 主进程（Node.js 环境，可访问系统 API）
├── preload/    # 预加载脚本（桥接层，暴露最小化 API 给渲染进程）
├── renderer/   # React UI（浏览器环境，禁止直接访问 Node.js）
├── shared/     # 共享类型、常量、工具函数（主进程与渲染进程共用）
└── tests/      # 测试文件
```

### 架构原则

- **进程隔离**: 主进程与渲染进程严格分离，所有跨进程通信通过 preload + IPC 桥接
- **类型优先**: 共享类型统一定义在 `src/shared/`，两进程共同引用；避免重复定义
- **新 UI 字符串走 i18n**: 使用 `useTranslation()` hook 或 `i18next.t()`，同步添加到 `src/renderer/i18n/locales/zh.json` 和 `en.json`
- **状态管理**: 跨组件状态用 zustand store，局部状态用 React useState

### 命名约定

| 元素 | 风格 | 示例 |
|------|------|------|
| 文件名 | kebab-case | `user-settings.ts`、`chat-panel.tsx` |
| React 组件 | PascalCase | `ChatPanel`、`UserSettings` |
| 函数/变量 | camelCase | `getUserConfig`、`isSandboxReady` |
| 常量 | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |
| 类型/接口 | PascalCase | `UserConfig`、`SandboxStatus` |

### 提交规范

- **Conventional Commits**，允许 type：`build | chore | ci | docs | feat | fix | merge | perf | refactor | revert | style | test`
- commitlint + husky 在 commit 时自动校验格式
- PR 分支策略：功能/修复 → `dev`；紧急修复 → `main`

---

## 4. 约束与禁止项

### 🚫 禁止行为

| 禁止项 | 说明 |
|--------|------|
| 禁止 `any` 类型 | 优先使用 `unknown` + 类型守卫；确有必要的个别场景需在 PR 中注释说明理由 |
| 禁止渲染进程使用 Node.js API | `fs`、`path`、`child_process` 等一律通过 preload + IPC 间接调用 |
| 禁止硬编码 UI 字符串 | 所有面向用户的文字必须走 i18next；仅技术日志、错误码、console 调试输出可例外 |
| 禁止直接操作 DOM | 禁止 `document.querySelector` 等；使用 React ref 或状态驱动 |
| 禁止 `--no-verify` 跳过 hooks | 不得绕过 commitlint、lint-staged、husky |
| 禁止 force push 到 main/dev | `git push --force` 仅允许在个人 feature 分支 |
| 禁止遗留 `console.log` | 调试日志用完即删；持久日志使用结构化 logger |
| 禁止 `@ts-ignore` / `@ts-expect-error` 无注释 | 确有需要时须附注原因和移除条件 |
| 禁止引入非宽松许可证依赖 | 新增依赖前确认许可证兼容 MIT/BSD/Apache-2.0 |
| 禁止沙盒代码引入外部网络依赖 | 沙盒模块（WSL2/Lima）保持自包含 |

---

## 5. 工作流

### 日常开发流程

1. 从 `dev` 拉最新代码，创建 `feature/xxx` 或 `fix/xxx` 分支
2. 开发中遵守命名约定、类型规则、i18n 要求
3. 提交前执行：`npm run lint:fix && npm run format:check && npm test`
4. 使用 Conventional Commits 格式提交
5. 推送并创建 PR → `dev`
6. CI 全部通过 + 至少一个 reviewer 批准后合并

### AI Agent 工作规则

- **修改代码前须征得用户同意**，不得在未经确认的情况下直接改动任何源文件
- **提交代码前须征得用户同意**，不得在未经确认的情况下执行 `git commit` 或 `git push`
- 修改代码前先阅读相关文件上下文，不修改无关区域
- 新增功能必须同步写 Vitest 测试
- 新增 UI 字符串必须同步更新 `zh.json` 和 `en.json`
- 修改 `src/shared/` 类型时，检查所有引用方是否兼容
- 修改沙盒代码（`src/main/sandbox/`）时考虑跨平台（Windows/macOS）行为差异

### 高风险区域

- `src/main/sandbox/` — 沙盒隔离与跨平台适配，修改后需在双平台验证
- `src/main/ipc/` — 进程间通信，注意安全边界与最小化 API 暴露
- `src/preload/` — 桥接层，只暴露必要 API，不得扩大权限面
- `electron-builder` 配置 — 打包、签名、平台差异
