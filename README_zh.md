<p align="center">
  <img src="resources/logo.png" alt="DeskWand Logo" width="280" />
</p>

<h1 align="center">DeskWand</h1>
<p align="center"><strong>开源 AI 桌面 Agent。</strong></p>

<p align="center">
  <a href="https://deskwand.com">官网</a> ·
  <a href="https://deskwand.com/#download">下载</a> ·
  <a href="https://github.com/deskwand/agent/releases">版本发布</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
</p>

<p align="center">
  <a href="./readme.md">English</a>
</p>

---

## 什么是 DeskWand

DeskWand 是基于 Pi Agent SDK 构建的桌面 AI Agent。

与聊天机器人不同，DeskWand 能够理解目标、规划任务、使用工具、委托子 Agent 协同工作，并在你的电脑上执行复杂任务。它会从成功的任务中学习，把经验沉淀为可复用技能，越用越顺手。

---

## 核心功能

**目标驱动。** 给出一个目标，Agent 自动规划并执行。

**子 Agent。** 将复杂任务拆分为专业 Agent，并行协作。

**网络搜索与工具。** 搜索开箱即用，无需配置。

**桌面原生。** 直接操作你的本地文件、项目和开发环境。

**Agent 原生 Office。** 要报告、表格还是演示稿，Agent 直接写出真正的 Word、Excel、PPT 文件。

**自进化技能。** 成功执行的任务可转化为可复用技能。

**多模型支持。** 自由选择最适合你的 AI 模型。

**用量与参考成本。** 只统计这台设备，按公开价目表估算 —— 可按模型、日期查看，币种可切换。

**独立视觉模型。** 支持独立配置视觉模型，解决 DeepSeek 等非多模态模型的识图问题。

**Pi 扩展与市场。** 运行 Pi CLI 扩展，从内置包市场安装插件、技能和提示词。

**消息渠道。** 通过 Telegram、Discord、QQ、Slack、微信、飞书与你的 Agent 交互。

---

## 基于 Pi Agent SDK 构建

DeskWand 基于开源的 Pi Agent SDK 构建。Pi 提供 Agent 基础设施，DeskWand 在此基础上加上产品层：目标执行、子 Agent 编排、工具生态、网络能力和技能学习。

---

## 工作原理

```
    Your Goal
        |
    Agent Planning
        |
    Subagents + Tools
        |
    Task Execution
        |
    New Skill Learned
        |
    Better Future Tasks
```

---

## 看看 DeskWand 如何工作

<table>
  <tr>
    <td width="50%" align="center">
      <a href="https://file.deskwand.com/media/demos/meeting-minutes.mp4"><img src="https://file.deskwand.com/media/demos/meeting-minutes.webp" alt="从会议记录到 Word 文档" width="100%"></a><br>
      <strong>会议记录 → Word 文档</strong>
    </td>
    <td width="50%" align="center">
      <a href="https://file.deskwand.com/media/demos/web-research.mp4"><img src="https://file.deskwand.com/media/demos/web-research.webp" alt="从网页调研到管理简报" width="100%"></a><br>
      <strong>网页调研 → 管理简报</strong>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <a href="https://file.deskwand.com/media/demos/excel-analysis.mp4"><img src="https://file.deskwand.com/media/demos/excel-analysis.webp" alt="从 Excel 分析到图表报告" width="100%"></a><br>
      <strong>Excel 分析 → 图表报告</strong>
    </td>
    <td width="50%" align="center">
      <a href="https://file.deskwand.com/media/demos/code-fix.mp4"><img src="https://file.deskwand.com/media/demos/code-fix.webp" alt="修复代码并通过测试" width="100%"></a><br>
      <strong>缺陷描述 → 测试通过</strong>
    </td>
  </tr>
</table>

---

### 安装

| 平台 | 下载 |
|------|------|
| macOS | [`.dmg`](https://github.com/deskwand/agent/releases) |
| Windows | [`.exe`](https://github.com/deskwand/agent/releases) |
| Linux | [`.AppImage`](https://github.com/deskwand/agent/releases) · [`.deb`](https://github.com/deskwand/agent/releases) |

[deskwand.com/#download](https://deskwand.com/#download)

### 快速开始

1. 下载并安装
2. 添加你的 API Key
3. 选择一个模型
4. 设定目标，DeskWand 会自动规划、执行并持续推进

### 文档

- [用户手册](https://www.deskwand.com/zh/manual)：从安装到高级功能的完整指南
- [源码](https://github.com/deskwand/agent)：配置、模型、技能、MCP 等

<p align="center">
  <a href="https://deskwand.com">deskwand.com</a>
</p>
