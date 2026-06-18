---
name: web-fetch
description: "Search the web and fetch webpage content. Use when user asks to search for information, read a webpage, or summarize online content."
version: 1.0.0
author: omagt
license: MIT
metadata:
  tags: [Web, Search, Scraping, Content, Research]
allowed-tools: "web_search,web_fetch,read"
---

# Web Fetch & Search

Search for information and extract content from web pages.

## When to use

- User asks to search for something online
- User provides a URL and wants to read/summarize it
- User wants to research a topic with multiple sources
- User asks "what's new with X" or "find information about Y"

## Search Workflow

1. **Search first**: `web_search(query="<query>")` — returns ranked results with URLs and snippets
2. **Extract from results**: Identify the most relevant URLs from search results
3. **Fetch content**: `web_fetch(url="<url>", max_chars=8000)` — extracts clean Markdown
4. **If content exceeds max_chars**: `web_fetch` returns `has_more=true` with persisted content. Use `read` with pagination to continue.

## Best Practices

- **Be specific in queries**: "React 19 server components performance benchmark 2025" > "React performance"
- **Prefetch multiple sources**: For research, fetch 2-3 top results and cross-reference
- **Check dates**: Prefer recent results for time-sensitive queries
- **Respect paywalls**: If web_fetch returns limited content, acknowledge the limitation
- **Summarize after fetching**: Don't dump raw content; synthesize key points

## Web Fetch Parameters

```
web_fetch(
  url="https://example.com/article",
  max_chars=8000   # default 8000, max 20000
)
```

Returns:
- Markdown-formatted body text
- `has_more` flag if content truncated
- `persisted` flag for paginated access

## Research Mode

For in-depth research:

1. `web_search(query="...")` — broad search
2. Identify 2-4 most relevant results
3. `web_fetch(url=...)` for each
4. Cross-reference facts across sources
5. Synthesize findings with source citations
6. If evidence insufficient, do targeted follow-up searches

## Constraints

- Always cite sources (URL + title) for factual claims
- Distinguish between verified facts and opinion/analysis
- When search returns no good results, tell user — don't fabricate
- Never fetch the same URL redundantly
