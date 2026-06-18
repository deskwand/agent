---
name: text-summarizer
description: "Summarize long texts, articles, and documents into concise key points. Use when user asks to summarize, condense, or extract key information from text."
version: 1.0.0
author: omagt
license: MIT
metadata:
  tags: [Summarization, Text, Content, Reading, TLDR]
allowed-tools: "read,web_fetch"
---

# Text Summarizer

Condense long-form content into structured, actionable summaries.

## When to use

- User provides long text and wants "the key points"
- User asks for TLDR of an article
- User wants to extract main arguments from a document
- Content is >500 words and user needs a quick overview

## Summary Formats

Choose format based on user's goal:

### 1. TLDR (1-3 sentences)
For: quick overview, "what's this about?"

```
**TLDR:** [One-sentence summary of the core message]
```

### 2. Key Points (3-7 bullets)
For: understanding main arguments, studying

```markdown
## Summary: [Title/Source]

### Key Points
- [Point 1 — one sentence each]
- [Point 2]
- [Point 3]

### Main Argument
[1-2 sentences on the central thesis]

### Notable Details
- [Important supporting facts or data points]
```

### 3. Structured Brief (sections)
For: long documents, research papers, reports

```markdown
# [Title] — Summary

**Source:** [URL/reference]
**Date:** [if available]

## Purpose
[What this document is trying to achieve — 1 sentence]

## Key Findings / Arguments
1. ...
2. ...

## Evidence
- ...

## Conclusions / Recommendations
- ...

## Relevance
[Why this matters to the user's context — if applicable]
```

## Processing Strategy

### By Content Length

| Length | Strategy |
|--------|----------|
| <500 words | Read fully, output TLDR |
| 500-2000 words | Read fully, output Key Points |
| 2000-5000 words | Scan sections, output Structured Brief |
| >5000 words | Section-by-section scanning, output Structured Brief with section summaries |

### Quality Rules

1. **Preserve the core argument** — don't just list facts; capture the thesis
2. **Distinguish fact from opinion** — label claims vs evidence
3. **Omit examples unless critical** — keep summaries lean
4. **Keep original terminology** — don't over-simplify technical terms
5. **Flag uncertainties** — if the text is ambiguous, note it

## Constraints

- Never inject your own opinion into the summary
- Don't add information not present in the source
- When summarizing web content, cite the URL
- If source is too long to process, be transparent about what was scanned vs read fully
