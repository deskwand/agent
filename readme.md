<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="resources/logo-dark.png">
    <img src="resources/logo-light.png" alt="DeskWand" width="360">
  </picture>
</p>

<h1 align="center">DeskWand Agent</h1>

<p align="center">
  <b>Use any model from any provider.</b><br>
  Open source and local-first — your data never leaves your machine.
</p>

<p align="center">
  <a href="https://github.com/deskwand/agent/releases"><img src="https://img.shields.io/github/v/release/deskwand/agent?style=flat-square&amp;label=release&amp;color=2563eb" alt="Release"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-1e293b?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/license-MIT-16a34a?style=flat-square" alt="License">
  <a href="https://github.com/deskwand/agent/stargazers"><img src="https://img.shields.io/github/stars/deskwand/agent?style=flat-square&amp;color=f59e0b" alt="Stars"></a>
  <img src="https://img.shields.io/badge/PRs-welcome-7c3aed?style=flat-square" alt="PRs welcome">
</p>

<p align="center">
  <a href="https://deskwand.com">Website</a> ·
  <a href="https://www.deskwand.com/manual">Docs</a> ·
  <a href="https://github.com/deskwand/agent/releases">Releases</a> ·
  <a href="./README_zh.md">中文</a>
</p>

<p align="center">
  <img src="https://www.deskwand.com/hero.png" alt="The DeskWand desktop app" width="1000">
</p>

---

## Voice mode

Talk to it. Cut in whenever you want. It answers out loud, and every piece of
speech work happens on your own machine.

<p align="center">
  <img src="resources/voice-mode-en.webp" alt="Voice mode: the star orb while it speaks, with the state caption and the sentence being read underneath" width="720">
</p>

**Speak, don't type.** Hold `Right Option` (macOS) or `Right Alt` (Windows) and
talk. The transcript lands in the input box, cleaned up into written language.

**Three quality tiers.** Fast, balanced, or best-quality. The last one runs a
1.5&nbsp;GB local model and keeps working offline — macOS Apple silicon today
(about 3.8&nbsp;GB RAM while speaking, released after 10 idle minutes).

**Nine voices.** Including Sichuan and Beijing dialects, with speed and speaking
style you can change mid-conversation.

**Interruption is a first-class feature.** It hears the sentence you are
finishing, not a timer — so a pause mid-thought doesn't cut you off, and a
one-word filler ("嗯", "对", "好") doesn't throw away the answer.

---

## Hand it the task. Watch it finish.

Four real jobs, every step visible.

### Meeting notes → Word

Turns raw notes into decisions, owners and deadlines in a Word document you can send.

```text
MEETING MINUTES · PROJECT NOVA
Weekly meeting · July 18 · 6 attendees · 45 minutes

── written in 1m 12s ───────────────────────────────────────────────

decisions
  · expand the canary to 10%        →  Wang Lin
  · backfill the Portal dashboard   →  Li Zhe
  · send the risk list to support   →  Chen Fan
```

### Web research → sourced brief

Finds the sources, cross-checks them, and cites every claim it makes.

```text
5 sources cross-checked
  reuters.com         ✓
  nvidia.com          ✓
  theinformation.com  ✓
  trendforce.com      ✓
  +1 excluded — data out of date

── finding ─────────────────────────────────────────────────────────

Data-centre GPU lead times have fallen back to 6–8 weeks, approaching
2023 levels [1][2], but HBM is still the bottleneck — next generation
volumes depend on SK Hynix's expansion [3][4].
```

### Spreadsheet → the problem in one look

Opens the real workbook, works out the movement and the cause, writes the page.

```text
Region         Q2      Q3     QoQ   Q3 revenue
East       12.84M  17.71M  +37.9%   ████████████
South       9.62M  10.48M   +8.9%   ███████
North      11.05M   9.38M  −15.1%   ██████
Southwest   4.18M   5.22M  +24.9%   ███

North fell because two contracts lapsed — 78% of the drop.
```

### A bug report → tests that actually pass

Reads the repo, fixes the defect, runs the suite, and shows you the change.

```diff
  src/labels.ts
  function label(name: string) {
-   return name;
+   const text = name.trim();
+   return text || 'Untitled';
  }

  ✓ labels.spec.ts    ✓ form.spec.ts    ✓ api.spec.ts
  12 passed · 0 failed

+ branch fix/empty-label — waiting for your review
```

---

## How it works

```text
  your goal ──▶ plan ──▶ subagents + tools ──▶ result ──▶ a skill
                                                                │
 next task starts here ◀────────────────────────────────────────┘
```

---

## Everything in the box

**Agent core**

| Capability                      | What it does                                                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Goal-driven execution**       | Give it a goal — it plans, uses tools, and keeps going until the job is done.                                                                       |
| **Subagents**                   | Complex work splits into specialised agents that run in parallel.                                                                                   |
| **Self-improving skills**       | A successful task can become a reusable skill, so the next one starts further along.                                                                |
| **Web search built in**         | No separate key — search inherits the provider key you already set up. Dedicated backends (Brave, Exa, Tavily, Parallel, Perplexity) if you prefer. |
| **Pi extensions & marketplace** | Run Pi CLI extensions, install plugins, skills and prompt templates from the built-in marketplace.                                                  |

**Desktop & documents**

| Capability              | What it does                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| **Desktop native**      | Works with your real files, projects and environment — not a sandboxed upload box.                     |
| **Agent-native Office** | Ask for a report, a spreadsheet or a deck; the agent writes the actual Word, Excel or PowerPoint file. |
| **On-device OCR**       | Reads text out of screenshots and scanned pages without uploading them.                                |
| **Messaging channels**  | Reach your agent from Telegram, Discord, QQ, Slack, WeChat or Feishu.                                  |

**Models, cost & privacy**

| Capability                   | What it does                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Any model, any provider**  | Bring your own key — Anthropic, OpenAI, Gemini, DeepSeek, GLM, Kimi, MiniMax, OpenRouter, Ollama, or any compatible endpoint. Switch per session. |
| **Standalone vision model**  | Pair a vision model with a text model, so non-multimodal models can still read images.                                                            |
| **Usage and estimated cost** | Priced from a public price table — by model, by day, by currency, for this machine only.                                                          |
| **Local-first by default**   | Prompts, files and sessions stay on your machine; cloud sync is opt-in, not required.                                                             |

---

## Open source, local-first

DeskWand is MIT-licensed and built on the [Pi Agent SDK](https://github.com/earendil-works/pi).
Bring your own model key: your prompts, files and sessions stay on your machine, and
model calls go only to the provider you chose. Two things do leave the machine — an
anonymous usage ping and the update check — and both can be switched off in Settings.
Want history on a second machine? Turn on cloud sync. Don't want to? Skip it.

```bash
git clone https://github.com/deskwand/agent.git
cd agent && npm install && npm run dev
```

---

## Install

| Platform    | Package                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **macOS**   | [`.dmg`](https://github.com/deskwand/agent/releases/latest) · Apple silicon                                                    |
| **Windows** | [`.exe`](https://github.com/deskwand/agent/releases/latest) · installer                                                        |
| **Linux**   | [`.AppImage`](https://github.com/deskwand/agent/releases/latest) · [`.deb`](https://github.com/deskwand/agent/releases/latest) |

**[All releases →](https://github.com/deskwand/agent/releases)** · [deskwand.com/#download](https://deskwand.com/#download)

## Quick start

1. Download and install
2. Add an API key from any supported provider
3. Pick a model
4. Set a goal — DeskWand plans, executes, and keeps going on its own

## Documentation

- **[User manual](https://www.deskwand.com/manual)** — the complete guide, from first run to advanced features
- **[Issues](https://github.com/deskwand/agent/issues)** — bug reports and feature requests
- **[AGENTS.md](./AGENTS.md)** — how this repository is put together

## Development

```bash
npm run dev            # development build
npx vitest run         # test suite
npm run build          # package for the current platform
npx eslint <files> --fix && npx prettier --check <files>
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
(English messages, enforced by commitlint + husky). Bug reports and pull
requests are welcome.

<p align="center">
  <a href="https://www.deskwand.com">www.deskwand.com</a> ·
  <a href="https://x.com/deskwanda">X</a>
</p>
