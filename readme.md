<p align="center">
  <img src="resources/logo.png" alt="DeskWand Logo" width="280" />
</p>

# DeskWand

**Delegate repetitive computer work to a local-first AI desktop agent.**

DeskWand is an open-source desktop AI agent for Windows, macOS, and Linux.

It helps you browse, use tools, create documents, connect AI models, and turn repeatable workflows into reusable skills — all from a desktop app you control.

<p align="center">
  <a href="https://deskwand.com"><strong>Website</strong></a> ·
  <a href="https://deskwand.com"><strong>Download</strong></a> ·
  <a href="https://github.com/deskwand/agent/releases"><strong>Releases</strong></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
</p>

---

## Contents

- [Why DeskWand](#why-deskwand)
- [Features](#features)
  - [Autonomous Loop Agent](#autonomous-loop-agent)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Example Tasks](#example-tasks)
- [Models](#models)
- [Skills](#skills)
- [MCP](#mcp)
- [Privacy & Security](#privacy--security)


---

## Why DeskWand?

Most AI apps stop at chat. DeskWand is built for action.

Instead of only asking questions, you can delegate repetitive computer work:

- collect information from websites
- organize notes and documents
- run recurring workflows
- connect external tools
- reuse learned skills across similar tasks

---

## Features

### Desktop Agent

- Runs as a desktop app
- Supports Windows, macOS, and Linux
- Designed for multi-step computer workflows

### Autonomous Loop Agent

- Set a high-level goal with `/goal`
- Agent plans, executes, and auto-continues until done
- Optional `--tokens` / `--time` budgets to cap usage
- Real-time status bar: active, paused, complete, blocked

### Local-first Control

- Bring your own model API key
- Keep control of your configuration and workflow
- No required DeskWand cloud account

### Built-in Browser

- Browse websites
- Extract and summarize information
- Use web pages as task context

### Skills

- Capture repeatable workflows
- Reuse skills across similar tasks
- Build a personal automation layer over time

### MCP & Tools

- Connect external tools through MCP
- Extend DeskWand with custom capabilities
- Integrate with your existing workflow

### Multi-model Support

- Connect to different AI model providers
- Switch models based on task needs

---

## Installation

Download the latest version:

- macOS
- Windows
- Linux

👉 [Download DeskWand](https://deskwand.com)

Or download from [GitHub Releases](https://github.com/deskwand/agent/releases).

---

## Quick Start

1. Download and install DeskWand
2. Add your model API key
3. Choose a model
4. Ask DeskWand to complete a task
5. Review and approve actions when needed

---

## Example Tasks

Try asking DeskWand:

- Research the top 5 alternatives to Linear and summarize them in a table.
- Collect pricing information from these websites and create a comparison document.
- Turn this recurring workflow into a reusable skill.
- Draft a project update based on these notes.
- Open the browser, check the latest release notes, and summarize what changed.

---

## Models

DeskWand supports multiple AI model providers, including Claude (Anthropic), GPT (OpenAI), Gemini (Google), DeepSeek, GLM (Zhipu AI), MiniMax, Kimi, and any OpenAI-compatible API endpoint. Bring your own API key and switch models based on task needs.

---

## Skills

Skills are reusable workflow templates that capture how to accomplish a specific type of task. DeskWand ships with built-in skills for document generation (PPTX, DOCX, XLSX, PDF) and web interaction, and you can create custom skills with the built-in skill-creator toolkit.

---

## MCP

DeskWand supports the [Model Context Protocol](https://modelcontextprotocol.io) (MCP), allowing you to connect external tools and services — such as browsers, Notion, databases, and custom APIs — and extend the agent's capabilities beyond built-in features.

---

## Privacy & Security

DeskWand is designed as a local-first desktop app.

- Your model API key is configured locally
- DeskWand does not require a DeskWand cloud account
- Actions should be visible and reviewable by the user
- You stay in control of connected tools and workflows

Please review the source code and configuration before connecting sensitive accounts or tools.



---

<p align="center">
  <a href="./README_zh.md">中文文档</a>
</p>
