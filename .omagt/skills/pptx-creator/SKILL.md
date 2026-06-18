---
name: pptx-creator
description: "Create, read, edit .pptx decks, slides, notes, templates. Use when user mentions deck, slides, presentation, or .pptx files."
version: 1.0.0
author: omagt (adapted from Hermes Agent powerpoint)
license: MIT
metadata:
  source: adapted from Hermes Agent powerpoint skill
  tags: [PowerPoint, Slides, Presentation, PPTX]
allowed-tools: "read,write,shell,generate_image,tool_gateway"
---

# PowerPoint Skill

Use this skill any time a .pptx file is involved — creating, reading, editing, templates, or extracting content.

## Quick Reference

| Task | Approach |
|------|----------|
| Read/analyze content | `tool_gateway(category=doc, tool_name=read_document, arguments={"file_path":"presentation.pptx"})` |
| Edit existing | See [editing.md](editing.md) |
| Create from scratch | See [pptxgenjs.md](pptxgenjs.md) |

---

## Reading Content

Primary path: `tool_gateway(action=call_tool, category=doc, tool_name=read_document)`

Shell fallback:
```bash
pip install "markitdown[pptx]"
python -m markitdown presentation.pptx
```

---

## Editing Workflow

**Read [editing.md](editing.md) for full details.**

1. Analyze template — read the .pptx to understand slides/layouts
2. Unpack → manipulate slides → edit content → clean → pack (see editing.md scripts section)

---

## Creating from Scratch

**Read [pptxgenjs.md](pptxgenjs.md) for full details.**

Use when no template is available. PptxGenJS is the recommended approach.

---

## Design Guidelines

**Don't create boring slides.** Plain bullets on a white background won't impress.

### Before Starting
- **Pick a bold, content-informed color palette** — should feel designed for THIS topic
- **Dominance over equality**: One color should dominate (60-70% visual weight)
- **Dark/light contrast**: Dark backgrounds for title + conclusion, light for content ("sandwich" structure)
- **Commit to a visual motif**: Pick ONE distinctive element and repeat it across slides

### Per-Slide Rules
- **Every slide needs a visual element** — image, chart, icon, or shape
- Layout options: two-column, icon+text rows, 2x2 grid, half-bleed image
- Data display: large stat callouts, comparison columns, timelines
- Typography: interesting font pairing, titles 36-44pt, body 14-16pt

### Avoid (Common Mistakes)
- Don't repeat the same layout across slides
- Don't center body text — left-align
- Don't default to blue — pick topic-specific colors
- Don't create text-only slides
- **NEVER use accent lines under titles** — hallmark of AI-generated slides

See [pptxgenjs.md](pptxgenjs.md) for color palettes, typography pairings, and spacing rules.

---

## QA (Required)

**Assume there are problems. Your job is to find them.**

1. Generate slides → verify content with `read_document`
2. Check for overlapping elements, text overflow, spacing issues
3. **Do not declare success until you've completed at least one fix-and-verify cycle.**

---

## Dependencies

- `pip install "markitdown[pptx]"` — text extraction
- `npm install -g pptxgenjs` — creating from scratch
- LibreOffice (`soffice`) — PDF conversion (optional, for visual QA)
