<p align="center">
  <img src="resources/logo.png" alt="DeskWand Logo" width="280" />
</p>

# DeskWand

**把电脑上的重复执行，交给本地优先的 AI 桌面 Agent。**

DeskWand 是一款开源桌面 AI Agent，支持 Windows、macOS 和 Linux。

它可以帮助你浏览网页、调用工具、生成文档、连接多种 AI 模型，并把重复流程沉淀成可复用技能——一切都在你掌控的桌面应用中完成。

<p align="center">
  <a href="https://deskwand.com"><strong>官网</strong></a> ·
  <a href="https://deskwand.com"><strong>下载</strong></a> ·
  <a href="https://github.com/deskwand/agent/releases"><strong>版本发布</strong></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
</p>

---

## 目录

- [为什么选择 DeskWand](#为什么选择-deskwand)
- [核心功能](#核心功能)
  - [自主循环 Agent](#自主循环-agent)
- [安装方式](#安装方式)
- [快速开始](#快速开始)
- [示例任务](#示例任务)
- [模型配置](#模型配置)
- [技能系统](#技能系统)
- [MCP 支持](#mcp-支持)
- [隐私与安全](#隐私与安全)


---

## 为什么选择 DeskWand？

大多数 AI 应用停留在聊天。DeskWand 面向执行。

你不仅可以向 AI 提问，还可以把重复性的电脑工作委派给它：

- 从网页收集信息
- 整理笔记和文档
- 执行周期性流程
- 连接外部工具
- 在类似任务中复用已经沉淀的技能

---

## 核心功能

### 桌面 Agent

- 作为桌面应用运行
- 支持 Windows、macOS 和 Linux
- 面向多步骤电脑任务设计

### 自主循环 Agent

- `/goal` 设定高维目标，Agent 自主跑完
- 可选 `--tokens` / `--time` 预算上限
- 状态栏实时显示：执行中、已暂停、已完成、已阻塞

### 本地优先

- 使用你自己的模型 API Key
- 配置和工作流由你掌控
- 不强制依赖 DeskWand 云账号

### 内置浏览器

- 浏览网页
- 提取和总结信息
- 将网页内容作为任务上下文

### 技能系统

- 沉淀可重复流程
- 在类似任务中复用技能
- 逐步构建个人自动化能力

### MCP 与工具调用

- 通过 MCP 连接外部工具
- 扩展 DeskWand 的能力边界
- 接入已有工作流

### 多模型支持

- 连接不同 AI 模型服务商
- 根据任务选择合适模型

---

## 安装

下载最新版本：

- macOS
- Windows
- Linux

👉 [下载 DeskWand](https://deskwand.com)

也可以从 [GitHub Releases](https://github.com/deskwand/agent/releases) 下载。

---

## 快速开始

1. 下载并安装 DeskWand
2. 添加你的模型 API Key
3. 选择模型
4. 向 DeskWand 委派一个任务
5. 在需要时查看并确认操作

---

## 示例任务

你可以这样委派 DeskWand：

- 调研 Linear 的 5 个替代产品，并用表格总结。
- 从这些网站收集价格信息，生成对比文档。
- 把这个重复流程沉淀成一个可复用技能。
- 根据这些笔记起草一份项目进展更新。
- 打开浏览器，查看最新版本说明，并总结变化。

---

## 模型配置

DeskWand 支持多种 AI 模型服务商，包括 Claude（Anthropic）、GPT（OpenAI）、Gemini（Google）、DeepSeek、智谱 GLM、MiniMax、Kimi，以及任何提供 OpenAI 兼容 API 的服务商。使用你自己的 API Key，根据任务需求灵活切换模型。

---

## 技能系统

技能是可复用的工作流模板，记录了如何完成特定类型的任务。DeskWand 内置了文档生成（PPTX、DOCX、XLSX、PDF）、网页交互等技能，你也可以通过内置的 skill-creator 工具包创建自定义技能。

---

## MCP 支持

DeskWand 支持 [Model Context Protocol](https://modelcontextprotocol.io)（MCP），让你可以连接浏览器、Notion、数据库、自定义 API 等外部工具与服务，将 Agent 的能力扩展到内置功能之外。

---

## 隐私与安全

DeskWand 采用本地优先设计。

- 模型 API Key 由用户在本地配置
- 不强制要求 DeskWand 云账号
- Agent 操作应当对用户可见、可检查
- 外部工具和工作流由用户自行掌控

在连接敏感账号或工具前，建议先查看源码和配置。



---

<p align="center">
  <a href="./README.md">English Docs</a>
</p>
