---
name: web-search
description: "Search the web and fetch webpage content. Use when user asks to search for information, read a webpage, or summarize online content."
version: 1.0.0
author: deskwand
license: MIT
metadata:
  tags: [Web, Search, Scraping, Content, Research]
allowed-tools: "web_search,fetch_content,get_search_content"
---

# Web Search & Fetch

Search for information and extract content from web pages.

## When to use

- User asks to search for something online
- User provides a URL and wants to read/summarize it
- User wants to research a topic with multiple sources
- User asks "what's new with X" or "find information about Y"

## Search Workflow

1. **Search first**: `web_search(query="<query>")` — returns ranked results with URLs and snippets
2. **Extract from results**: Identify the most relevant URLs from search results
3. **Fetch content**: `fetch_content(url="<url>")` — extracts clean Markdown. Pass `urls` to fetch several pages in one call.
4. **If you need the full page rather than the snippet**: call `get_search_content(responseId=…)` with the id returned by the earlier `web_search` / `fetch_content` call, and narrow it with `query`, `url`, or `urlIndex`. To retain full pages from a search in the first place, set `includeContent` on `web_search`.

## Best Practices

- **Be specific in queries**: "React 19 server components performance benchmark 2025" > "React performance"
- **Prefetch multiple sources**: For research, fetch 2-3 top results and cross-reference
- **Check dates**: Prefer recent results for time-sensitive queries
- **Respect paywalls**: If fetch_content returns limited content, acknowledge the limitation
- **Summarize after fetching**: Don't dump raw content; synthesize key points

## Research Mode

For in-depth research:

1. `web_search(query="...")` — broad search
2. Identify 2-4 most relevant results
3. `fetch_content(url=...)` for each
4. Cross-reference facts across sources
5. Synthesize findings with source citations
6. If evidence insufficient, do targeted follow-up searches

## Constraints

- Always cite sources (URL + title) for factual claims
- Distinguish between verified facts and opinion/analysis
- When search returns no good results, tell user — don't fabricate
- Never fetch the same URL redundantly
