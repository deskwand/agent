---
name: blog-writer
description: "Write technical blog posts, articles, and documentation. Use when user asks to write a blog post, article, tutorial, or documentation page."
version: 1.0.0
author: omagt
license: MIT
metadata:
  tags: [Writing, Blog, Article, Documentation, Content]
allowed-tools: "read,write,web_search"
---

# Blog Writer

Write clear, engaging technical content.

## When to use

- User asks to "write a blog post about X"
- User wants to create a tutorial or how-to guide
- User needs documentation for a project or API
- User wants to explain a technical concept to a specific audience

---

## Content Types

### 1. Technical Tutorial (How-To)

```markdown
# [Title: Action-Oriented, e.g. "How to Set Up X in 10 Minutes"]

**Audience:** [skill level]
**Prerequisites:** [what reader needs installed/known]
**Time to complete:** [estimate]

## What You'll Build
[1-2 sentences + optional screenshot]

## Step 1: [Action]
[Explain what and why]
```bash
# commands
```
[Explain the output]

## Step 2: [Action]
...

## Troubleshooting
[Common issues and fixes]

## Next Steps
[Where to go from here]
```

### 2. Technical Deep-Dive

```markdown
# [Title: Concept-Focused, e.g. "Understanding X: How It Works Under the Hood"]

## The Problem
[Why existing solutions fall short]

## How X Solves It
[Core idea, diagrams help]

## Key Design Decisions
[Trade-offs, why choices were made]

## Performance / Benchmarks
[Data, charts]

## When to Use (and When Not To)
[Practical guidance]
```

### 3. Project Announcement / Release Post

```markdown
# [Project Name] v[X.X]: [Headline Feature]

## What's New
- **Feature A**: [what it does, why it matters]
- **Feature B**: ...

## Getting Started
```bash
# install/upgrade command
```

## What's Next
[Roadmap hints]
```

---

## Writing Guidelines

1. **Lead with value** — first paragraph should answer "why should I read this?"
2. **One idea per paragraph** — avoid wall-of-text
3. **Show, don't just tell** — code snippets > descriptions
4. **Use headings to create scannable structure** — readers skim before reading
5. **End with a clear takeaway or call to action**
6. **Write for the target audience** — junior devs need more context, seniors want depth
7. **Keep it factual** — cite sources for claims, mark opinions clearly

## Tone Guide

| Context | Tone |
|---------|------|
| Tutorial | Friendly, encouraging, clear |
| Deep-dive | Analytical, precise, thorough |
| Announcement | Excited but professional |
| Documentation | Neutral, complete, reference-style |

## Constraints

- Never fabricate benchmarks, statistics, or user testimonials
- Code examples must be runnable (or clearly marked as pseudo-code)
- Cite external sources when referencing specific claims
- Keep introductions concise — get to the content quickly
