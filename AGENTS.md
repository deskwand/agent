# AGENTS.md

本文档指导 AI Agent 在本仓库安全、规范、高效地工作。技术栈、依赖与脚本以 `package.json` 为准。

## 1. 项目概述

- **deskwand（Oh My Agent）**：开源 AI 智能助手桌面应用
- Electron 主进程 + React/Tailwind 渲染层，TypeScript strict，npm，MIT
- 构建目标：Windows (.exe) + macOS (.dmg)，electron-builder 打包

## 2. 常用命令

```bash
npm run dev                      # 开发模式
npm run build                    # 生产构建（当前平台；macOS 构建 .dmg）
npm run build:win-x64            # 构建 Windows .exe
npm test                         # 全部测试
npx vitest run <file> -t "<name>"  # 聚焦单个测试用例
npm run lint:fix && npm run format:check   # 提交前检查
```

提交前必跑：`npm run lint:fix && npm run format:check && npm test`

## 3. 代码风格

- 文件名 `kebab-case`；常量 `UPPER_SNAKE_CASE`
- **UI 字符串一律走 i18n**，新增文案必须同步更新 `src/renderer/i18n/locales/zh.json` 与 `en.json`：

  ```ts
  // ❌ "保存失败" — 硬编码
  // ✅ const { t } = useTranslation(); t('settings.saveFailed')
  ```

- 颜色用语义 Token（`bg-success`、`text-error`），禁止硬编码色值（多主题/深浅兼容）

## 4. 架构要点

- **进程隔离**：跨进程通信只经 preload + IPC；渲染进程禁止使用 Node.js API（fs/path/child_process）
- **类型优先**：共享类型统一定义在 `src/shared/`；修改时检查所有引用方
- 跨组件状态用 zustand store，局部状态用 useState；禁止直接操作 DOM（`querySelector` 等）
- 新增/接入 Tool 时，必须评估聊天过程摘要中的 Tool Group 归类、计数、图标与中英文文案，不得作为未分组工具展示

## 5. 约束

- 禁止 `any`（优先 `unknown` + 类型守卫；个别场景在 PR 注释理由；ESLint warn 级检查）
- 禁止遗留 `console.log`（结构化 logger 与沙盒协议输出除外；ESLint warn 级检查）
- 沙盒模块（`src/main/sandbox/`，WSL2/Lima）保持自包含：禁止外部网络依赖；考虑 Windows/macOS 差异
- 新增依赖前确认许可证兼容 MIT/BSD/Apache-2.0
- **禁止破坏提示词缓存**：编辑文件优先在尾部追加，避免在头部无必要插入、重排或改写大段内容；新增类型/函数/常量尽量靠文件尾部
- 提交规范由 commitlint + husky 强制（Conventional Commits、英文信息、禁止 `--no-verify`、禁止 force push main/dev），细则以 `commitlint.config.cjs` 为准

## 6. 工作流

1. 从 `dev` 拉最新，创建 `feature/xxx` 或 `fix/xxx` 分支
2. 开发中遵守上述约束；新增功能必须同步写 Vitest 测试
3. 提交前跑 §2 检查命令，提交后创建 PR → `dev`（紧急修复 → `main`）

### 高风险区域（改动前先阅读相关文件上下文）

- `src/main/sandbox/` — 沙盒隔离与跨平台适配，需双平台验证
- `src/main/ipc/` — 进程间通信，安全边界与最小化 API 暴露
- `src/preload/` — 桥接层，只暴露必要 API，不得扩大权限面
- `electron-builder.yml` — 打包、签名、平台差异

## 7. 设计文档与实现计划

brainstorming 设计文档、writing-plans 实现计划写入 `design-docs/`（已 gitignore，不提交 git），按「日期-主题」命名。**不要写进本文件**——本文件保持精简，只存对 Agent 有长期指导价值的规则。
