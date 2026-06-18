---
name: markdown-todo
description: "Manage task lists and to-do items in Markdown format. Use when user asks to create, organize, or track tasks and checklists."
version: 1.0.0
author: omagt
license: MIT
metadata:
  tags: [Tasks, TODO, Markdown, Productivity, Checklist]
allowed-tools: "read,write,shell"
---

# Markdown TODO Manager

Create and manage task lists in Markdown format.

## When to use

- User asks to "create a task list" or "track my todos"
- User wants to organize action items from a meeting or discussion
- User wants a checklist for a project or process
- User asks to create a sprint backlog or project board in text form

---

## Task List Format

```markdown
# [Project Name] — Task Board

**Updated:** YYYY-MM-DD

## 🔴 In Progress
- [ ] Task title — @owner (due: YYYY-MM-DD)
  - Details or sub-tasks
- [ ] Another task — @owner

## 🟡 Planned / Backlog
- [ ] Task title — priority: high
- [ ] Task title — priority: medium

## 🟢 Done (this week)
- [x] Completed task — finished YYYY-MM-DD

## ⚫ Blocked
- [ ] Blocked task — blocked by: [reason]
```

---

## Task Item Conventions

Each task follows this format:
```
- [ ] <Task description> — @<owner> (due: <date>) <priority: high|medium|low>
```

### Status Indicators

| Marker | Meaning |
|--------|---------|
| `- [ ]` | Not started |
| `- [~]` | In progress |
| `- [x]` | Done |
| `- [!]` | Blocked / urgent |
| `- [?]` | Needs clarification |

---

## Operations

### Add a task
Insert a new `- [ ]` line in the appropriate section.

### Move a task between sections
Change the section the task belongs to.

### Mark complete
Change `- [ ]` to `- [x]` and add completion date: `— finished YYYY-MM-DD`

### Prioritize
Add `priority: high|medium|low` tag.

### Generate from meeting notes
1. Read the meeting notes
2. Extract all action items
3. Generate a TODO board with owners and due dates

---

## Project Board Template

```markdown
# Project Board

## Goals
- [ ] Goal 1 — target: YYYY-MM-DD
- [ ] Goal 2 — target: YYYY-MM-DD

## This Sprint (YYYY-MM-DD → YYYY-MM-DD)
### To Do
- [ ] Task — @owner (est: 2h)
- [ ] Task — @owner (est: 4h)

### In Progress
- [ ] Task — @owner

### Review
- [ ] Task — @owner (needs review)

### Done
- [x] Task — @owner

## Retro Notes
- What went well:
- What to improve:
```

## Constraints

- Keep task descriptions actionable and specific
- Avoid vague tasks like "work on project" — be specific
- Don't over-engineer: use sections, not complex metadata
- Use Git to track todo.md changes if needed
