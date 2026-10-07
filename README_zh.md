<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="resources/logo-dark.png">
    <img src="resources/logo-light.png" alt="DeskWand" width="360">
  </picture>
</p>

<h1 align="center">DeskWand Agent</h1>

<p align="center">
  <b>支持任意模型提供商。</b><br>
  开源，本地优先 —— 你的数据永远不会离开你的机器。
</p>

<p align="center">
  <a href="https://github.com/deskwand/agent/releases"><img src="https://img.shields.io/github/v/release/deskwand/agent?style=flat-square&amp;label=release&amp;color=2563eb" alt="Release"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-1e293b?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/license-MIT-16a34a?style=flat-square" alt="License">
  <a href="https://github.com/deskwand/agent/stargazers"><img src="https://img.shields.io/github/stars/deskwand/agent?style=flat-square&amp;color=f59e0b" alt="Stars"></a>
  <img src="https://img.shields.io/badge/PRs-welcome-7c3aed?style=flat-square" alt="PRs welcome">
</p>

<p align="center">
  <a href="https://deskwand.com">官网</a> ·
  <a href="https://www.deskwand.com/zh/manual">使用手册</a> ·
  <a href="https://github.com/deskwand/agent/releases">版本发布</a> ·
  <a href="./readme.md">English</a>
</p>

<p align="center">
  <img src="https://www.deskwand.com/hero.png" alt="DeskWand 桌面应用" width="1000">
</p>

---

## 语音模式

开口就问，随时打断，它开口答你。而且整条语音链路都跑在你自己的机器上。

```text
✦ 语音模式 ───────────────────────────────────────────────────────────

  聆听    麦克风常开 · 识别在本机跑，不上传
  思考    答案边写边读
  > 朗读  开口说话，字幕跟着声音走，不跟段落走

      「目前有三个州要求披露 AI 生成内容 —— 加州、科罗拉多和康涅狄格。
       科罗拉多的规定 7 月 1 日生效。」

✦ 打断 ─────────────────────────────────────────────────────────────

    你说     「等一下，科罗拉多那条展开讲讲」
    它会停在半句上重新回答。随口一声「嗯」不算打断。
```

**不用打字。** 按住 `右 Option`（macOS）或 `右 Alt`（Windows）直接说话，转写
落进输入框，并自动整理成书面文字。

**三档音质。** 快速最省内存、均衡音质更好；最佳音质在本机跑 1.5 GB 本地大模型，
装完离线可用 —— 目前仅 macOS Apple 芯片可用（说话时约 3.8 GB 内存，空闲 10 分钟自动释放）。

**九个音色。** 含四川话与北京话，语速和说话风格随时可调。

**打断是一等功能。** 它听的是你把这句话说完没有，不是掐一个静音计时器 ——
所以想事情时的停顿不会把你切断，随口一声「嗯」也不会让刚才的答案作废。

---

## 交给它，然后看它做完

四件真实的事，每一步都能看见。

### 会议记录 → Word

把原始记录整理成决议、负责人和截止时间，写成一份能直接发出去的 Word 文档。

```text
MEETING MINUTES · PROJECT NOVA
周会纪要 · 7 月 18 日 · 参会 6 人 · 时长 45 分钟

── 整理用时 1 分 12 秒 ─────────────────────────────────────────────

决议
  · 灰度范围扩大到 10%           →  王琳
  · 补齐 Portal 埋点并回填看板   →  李哲
  · 风险清单同步给客服团队       →  陈帆
```

### 网络调研 → 带来源的简报

自己找资料、交叉核对，结论后面标清来源，不给你一个没有出处的答案。

```text
已核对 5 个来源
  reuters.com         ✓
  nvidia.com          ✓
  theinformation.com  ✓
  trendforce.com      ✓
  另有 1 个被排除 —— 数据过期

── 结论 ────────────────────────────────────────────────────────────

数据中心 GPU 的交付周期已回落到 6–8 周，接近 2023 年水平 [1][2]；
但 HBM 仍是瓶颈，下一代产品的放量节奏取决于 SK 海力士的扩产 [3][4]。
```

### 表格 → 一眼看出问题

打开真实的 Excel，算清楚涨跌和原因，再写成一页报告，不是丢给你一堆数字。

```text
区域        Q2        Q3    环比   Q3 营收
华东  1,284 万  1,771 万  +37.9%   ████████████
华南    962 万  1,048 万   +8.9%   ███████
华北  1,105 万    938 万  −15.1%   ██████
西南    418 万    522 万  +24.9%   ███

华北下滑主因：两个大客户合同到期未续，占跌幅的 78%。
```

### 报了个 bug → 测试真的通过

自己去仓库里看代码、改问题、跑测试，最后把改动摆出来给你检查。

```diff
  src/labels.ts
  function label(name: string) {
-   return name;
+   const text = name.trim();
+   return text || 'Untitled';
  }

  ✓ labels.spec.ts    ✓ form.spec.ts    ✓ api.spec.ts
  12 passed · 0 failed

+ 已写到分支 fix/empty-label —— 等你 review
```

---

## 工作原理

```text
  你的目标 ──▶ 规划拆解 ──▶ 子 Agent + 工具 ──▶ 结果 ──▶ 沉淀为技能
                                                                  │
 下一次任务直接从这里开始 ◀───────────────────────────────────────┘
```

---

## 都有什么

**Agent 内核**

| 能力              | 说明                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| **目标驱动**      | 给出一个目标，它自己规划、调用工具、持续推进，直到做完。                                                     |
| **子 Agent**      | 复杂任务拆成多个专业 Agent，并行协作。                                                                       |
| **自进化技能**    | 成功执行的任务可沉淀为可复用技能，下次直接从更远处起步。                                                     |
| **内置网络搜索**  | 不必再配 key —— 直接沿用你已经配好的模型 key；也可换成 Brave、Exa、Tavily、Parallel、Perplexity 等专用后端。 |
| **Pi 扩展与市场** | 运行 Pi CLI 扩展，从内置市场安装插件、技能和提示词。                                                         |

**桌面与文档**

| 能力                  | 说明                                                             |
| --------------------- | ---------------------------------------------------------------- |
| **桌面原生**          | 直接操作你本机的文件、项目和环境，而不是一个只能上传的沙盒。     |
| **Agent 原生 Office** | 要报告、表格还是演示稿，它直接写出真正的 Word、Excel、PPT 文件。 |
| **端侧 OCR**          | 从截图和扫描件里读文字，图片不出本机。                           |
| **消息渠道**          | 通过 Telegram、Discord、QQ、Slack、微信、飞书找到你的 Agent。    |

**模型、成本与隐私**

| 能力                     | 说明                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **任意模型、任意提供商** | 自带 key —— Anthropic、OpenAI、Gemini、DeepSeek、GLM、Kimi、MiniMax、OpenRouter、Ollama，或任何兼容端点，按会话切换。 |
| **独立视觉模型**         | 给文本模型单独配一个视觉模型，非多模态模型也能看图。                                                                  |
| **用量与参考成本**       | 按公开价目表估算，可按模型、日期查看，币种可切换，且只统计这台设备。                                                  |
| **默认本地优先**         | 提示词、文件和会话都在你机器上；云同步是可选项，不是前提。                                                            |

---

## 开源、本地优先

DeskWand 以 MIT 许可开源，构建在 [Pi Agent SDK](https://github.com/earendil-works/pi) 之上。
带上你自己的模型 key：提示词、文件和会话都留在这台机器上，模型请求只发往你选定的服务商。
有两件事确实会出网 —— 一条匿名用量统计和更新检查 —— 两者都能在设置里关掉。
想在第二台机器上接着用？打开云同步；不想？不开也行。

```bash
git clone https://github.com/deskwand/agent.git
cd agent && npm install && npm run dev
```

---

## 安装

| 平台        | 安装包                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **macOS**   | [`.dmg`](https://github.com/deskwand/agent/releases/latest) · Apple 芯片                                                       |
| **Windows** | [`.exe`](https://github.com/deskwand/agent/releases/latest) · 安装程序                                                         |
| **Linux**   | [`.AppImage`](https://github.com/deskwand/agent/releases/latest) · [`.deb`](https://github.com/deskwand/agent/releases/latest) |

**[全部版本 →](https://github.com/deskwand/agent/releases)** · [deskwand.com/#download](https://deskwand.com/#download)

## 快速开始

1. 下载并安装
2. 添加任意受支持服务商的 API Key
3. 选择一个模型
4. 设定目标，它会自己规划、执行，并持续推进

## 文档

- **[用户手册](https://www.deskwand.com/zh/manual)** —— 从第一次上手到高级功能的完整指南
- **[Issues](https://github.com/deskwand/agent/issues)** —— 提 bug、提需求
- **[AGENTS.md](./AGENTS.md)** —— 这个仓库是怎么组织的

## 开发

```bash
npm run dev            # 开发模式
npx vitest run         # 跑测试
npm run build          # 打包当前平台
npx eslint <files> --fix && npx prettier --check <files>
```

提交遵循 [Conventional Commits](https://www.conventionalcommits.org/)（英文提交信息，
由 commitlint + husky 强制）。欢迎提 issue 和 PR。

<p align="center">
  <a href="https://deskwand.com">deskwand.com</a> ·
  <a href="https://x.com/deskwanda">X</a>
</p>
