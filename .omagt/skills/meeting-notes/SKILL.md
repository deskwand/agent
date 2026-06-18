---
name: meeting-notes
description: "Generate structured meeting minutes from raw notes, transcripts, or recordings. Use when user asks to summarize a meeting, extract action items, or create meeting notes."
version: 1.0.0
author: omagt (adapted from Hermes Agent teams-meeting-pipeline)
license: MIT
metadata:
  source: adapted from Hermes Agent teams-meeting-pipeline v1.1.0
  tags: [Meetings, Notes, Minutes, Productivity, Summarization]
allowed-tools: "read,write,shell,web_fetch"
---

# Meeting Notes

Generate structured, actionable meeting minutes from any input format.

## When to use

- User provides meeting notes/transcript text and wants a summary
- User asks to extract action items from a meeting
- User has a recording or transcript URL
- User says "meeting minutes", "meeting notes", "summarize this meeting"

---

## Input Sources

| Source | Tool |
|--------|------|
| Raw text / notes | Parse directly |
| Transcript file | `read` the file |
| Meeting URL / recording | `web_fetch` if available |
| Audio file | Use transcription service first, then process |

---

## Output Template

```markdown
# Meeting Minutes: [Title]

**Date:** YYYY-MM-DD  |  **Time:** HH:MM - HH:MM  |  **Location:** [Room/Link]

## Attendees
- [Name] ([Role])

## Agenda
1. [Topic 1]
2. [Topic 2]

## Discussion Summary

### [Topic 1]
- Key points discussed
- Decisions made
- Alternatives considered

### [Topic 2]
- ...

## Action Items

| # | Action | Owner | Due | Status |
|---|--------|-------|-----|--------|
| 1 | [Task description] | @name | YYYY-MM-DD | ⬜ |
| 2 | [Task description] | @name | YYYY-MM-DD | ⬜ |

## Decisions Made
- [Decision 1] — rationale: [why]
- [Decision 2] — rationale: [why]

## Next Steps
- [ ] Schedule follow-up meeting (suggested: YYYY-MM-DD)
- [ ] Distribute minutes to attendees

## Notes
- [Any other important context or follow-up items]
```

---

## Processing Guidelines

1. **Identify participants** — list all mentioned names/roles
2. **Extract topics** — group discussion by agenda items
3. **Capture decisions** — any "we decided", "let's go with", "agreed to" → Decisions section
4. **Extract action items** — any "I'll", "we need to", "TODO", "@name will" → Action Items table
5. **Be concise** — focus on decisions and actions, not verbatim transcript
6. **Assign owners** — extract who committed to what; mark unowned items clearly

---

## Constraints

- Never fabricate decisions or attendees — only extract what's present in the source
- Mark uncertain items with `(?)` 
- Preserve original intent; don't reinterpret technical decisions
