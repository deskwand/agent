# DeskWand v1.0.12 Release Notes

---

## 中文

本次更新带来了 OpenRouter OAuth PKCE 登录支持，可自动拉取免费模型列表并优先展示；vision_describe 工具新增自定义 prompt 参数，支持按需指定识别指令。修复了多项体验问题：首次加载历史会话可能出现空白、思考流输出时强制滚动到底部导致无法手动翻阅、历史消息中工具调用无法合并为摘要卡片、ArtifactCard 相对路径在非默认工作目录下无法打开文件、侧边栏选中任务时布局抖动、已完成任务的对比度偏低等。UI 方面收紧了代码块垂直间距，调整了侧边栏未激活会话、已完成任务及新建对话按钮的层级色彩。

---

## English

This release introduces OpenRouter OAuth PKCE login with automatic free-model discovery and prioritization, plus a new optional `prompt` parameter for the `vision_describe` tool allowing custom recognition instructions. Several experience fixes are included: blank chat on initial session history hydration, forced scroll-to-bottom during invisible thinking streams that prevented manual scrolling, tool-call messages in history not being merged into summary blocks, ArtifactCard failing to resolve file paths outside the default workspace directory, sidebar selection layout jitter, and low contrast on completed task items. UI polish tightens code block vertical spacing and adjusts color hierarchy for inactive sidebar sessions, completed tasks, and the new-chat button.

---

## Changelog

### ✨ Features

- **OpenRouter OAuth PKCE Login** — In-app PKCE flow with callback server, live free-model list fetching, sorted first. Fallback to presets on API failure. Model search input in dropdown. ([125048f](https://github.com/deskwand/deskwand/commit/125048f))
- **Vision Describe Prompt Parameter** — Optional `prompt` string for `vision_describe` tool, wired through to providers with custom prompt summary in UI label and i18n support. ([47da7ed](https://github.com/deskwand/deskwand/commit/47da7ed))

### 🐛 Bug Fixes

- **Blank chat on session history hydration** — ([dfb7280](https://github.com/deskwand/deskwand/commit/dfb7280))
- **Memory ingestion decoupled from session completion** — ([95b6781](https://github.com/deskwand/deskwand/commit/95b6781))
- **Scroll-to-bottom during invisible thinking stream** — Only track visible content for scroll following. ([8e5e96b](https://github.com/deskwand/deskwand/commit/8e5e96b))
- **Pure-tool messages merged into preceding assistant** — Historical tool_use/tool_result now grouped into single process-summary blocks. ([b8a57d6](https://github.com/deskwand/deskwand/commit/b8a57d6))
- **OpenRouter provider cleanup on disconnect** — Fully delete instead of leaving empty shell; accept `oauth:` profile keys. ([3adaf17](https://github.com/deskwand/deskwand/commit/3adaf17))
- **ArtifactCard file path resolution** — Resolve relative paths against workspace cwd across all call sites. ([369ef3f](https://github.com/deskwand/deskwand/commit/369ef3f))
- **Sidebar current task layout jitter** — Reserve left border gutter on selection. ([2f6cf9a](https://github.com/deskwand/deskwand/commit/2f6cf9a))
- **Correct `web_fetch` tool name in block builder** — ([9f35b5d](https://github.com/deskwand/deskwand/commit/9f35b5d))
- **Lucide Check icon type error** — Replace `title` with `aria-label`. ([7f4c48c](https://github.com/deskwand/deskwand/commit/7f4c48c))

### 💄 Style

- Reduce code block vertical spacing ([d77ce5c](https://github.com/deskwand/deskwand/commit/d77ce5c))
- Lighten sidebar new-chat button and task completed checkmark ([0f277ad](https://github.com/deskwand/deskwand/commit/0f277ad))
- Lower non-active sidebar session items to text-secondary ([de569be](https://github.com/deskwand/deskwand/commit/de569be))
- Boost contrast of completed sidebar task items ([30a0918](https://github.com/deskwand/deskwand/commit/30a0918))

### 📝 Docs

- Require English commit messages ([a161602](https://github.com/deskwand/deskwand/commit/a161602))

### 🔧 Chores

- Bump version to 1.0.12 ([944af5c](https://github.com/deskwand/deskwand/commit/944af5c))
