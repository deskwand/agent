---
name: data-chart
description: "Generate professional dark-themed SVG architecture diagrams, cloud infrastructure diagrams, and data visualizations as standalone HTML files. Use when user asks to create system architecture diagrams, infrastructure maps, or data charts."
version: 1.0.0
author: omagt (adapted from Hermes Agent architecture-diagram, based on Cocoon AI)
license: MIT
metadata:
  source: adapted from Hermes Agent architecture-diagram (Cocoon AI, MIT)
  tags: [Architecture, Diagrams, SVG, HTML, Visualization, Charts, Cloud]
allowed-tools: "read,write,shell"
---

# Architecture Diagram & Chart Generator

Generate professional dark-themed diagrams as standalone HTML files with inline SVG. No external tools, no API keys — just write HTML and open in browser.

## When to use

**Best for:**
- System architecture diagrams (frontend/backend/database layers)
- Cloud infrastructure (VPC, regions, services)
- Microservice topology, deployment diagrams
- Data flow charts and pipeline diagrams

**For data charts (bar, line, pie):** output ```vega-lite``` code blocks directly in the response — see Vega-Lite Charting section below.

---

## Architecture Diagrams

### Workflow
1. User describes their system architecture
2. Generate HTML file following the design system below
3. Save to `.html` file
4. User opens in any browser — works offline

### Design System

| Component Type | Fill (rgba) | Stroke (Hex) |
|---|---|---|
| **Frontend** | `rgba(8, 51, 68, 0.4)` | `#22d3ee` (cyan) |
| **Backend** | `rgba(6, 78, 59, 0.4)` | `#34d399` (emerald) |
| **Database** | `rgba(76, 29, 149, 0.4)` | `#a78bfa` (violet) |
| **Cloud/AWS** | `rgba(120, 53, 15, 0.3)` | `#fbbf24` (amber) |
| **Security** | `rgba(136, 19, 55, 0.4)` | `#fb7185` (rose) |
| **Message Bus** | `rgba(251, 146, 60, 0.3)` | `#fb923c` (orange) |

- **Background**: Slate-950 (`#020617`) with 40px grid
- **Font**: JetBrains Mono, 12px names / 9px sublabels
- **Components**: Rounded rectangles (`rx="6"`), 1.5px strokes
- **Arrows**: Draw behind components; dashed for security flows

See [templates/template.html](templates/template.html) for the full HTML template with working examples.

---

## Vega-Lite Charting

For charts (bar, line, pie, scatter), output ```vega-lite``` code blocks:

```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": { "values": [...] },
  "mark": "bar",
  "encoding": {
    "x": { "field": "category", "type": "nominal" },
    "y": { "field": "value", "type": "quantitative" }
  }
}
```

### Chart Type Decision

| Data shape | Chart type |
|------------|-----------|
| Categories vs values | Bar (vertical) or Bar (horizontal for long labels) |
| Time series | Line or Area |
| Part-to-whole | Pie / Donut (≤6 segments) or Stacked Bar |
| Correlation | Scatter / Bubble |
| Distribution | Histogram / Box Plot |

---

## Output Requirements
- **Architecture diagrams**: Single `.html` file, all CSS/SVG inline
- **Charts**: ```vega-lite``` code block in response
- No external dependencies (except Google Fonts for diagrams)
