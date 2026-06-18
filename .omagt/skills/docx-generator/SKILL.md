---
name: docx-generator
description: "Generate and read Word (.docx) documents. Use when user asks to create a Word document, generate a report, or read a .docx file."
version: 1.0.0
author: omagt
license: MIT
metadata:
  tags: [Word, docx, Document, Report, Generation]
allowed-tools: "read,shell,tool_gateway"
---

# DOCX Generator

Create and read Microsoft Word documents.

## When to use

- User asks to "create a Word document" or "generate a report"
- User wants a formatted document for sharing/printing
- User needs to read a .docx file's contents

## Reading DOCX Files

### Path A — read_document (preferred)
```
tool_gateway(action=call_tool, category=doc, tool_name=read_document, arguments={"file_path":"/path/to/file.docx"})
```

### Path B — Python (shell fallback)
```bash
pip install python-docx

python3 -c "
from docx import Document
doc = Document('file.docx')
for p in doc.paragraphs:
    print(p.text)
"
```

## Creating DOCX Files

### With python-docx

```bash
pip install python-docx
```

```python
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

doc = Document()

# Title
title = doc.add_heading('Report Title', level=1)
title.alignment = WD_ALIGN_PARAGRAPH.CENTER

# Body text
doc.add_paragraph('This is a paragraph with some content.')

# Bold + italic
p = doc.add_paragraph()
run = p.add_run('Bold text')
run.bold = True

# Bullet list
doc.add_paragraph('First item', style='List Bullet')
doc.add_paragraph('Second item', style='List Bullet')

# Table
table = doc.add_table(rows=3, cols=3)
table.style = 'Light Grid Accent 1'
table.cell(0, 0).text = 'Header 1'
table.cell(0, 1).text = 'Header 2'
# Fill data...

# Save
doc.save('output.docx')
```

## Document Structure Template

For reports, follow this structure:
1. **Title page** — centered title, date, author
2. **Executive Summary** — 1-2 paragraphs
3. **Main Content** — sections with headings
4. **Tables/Data** — where applicable
5. **Conclusions / Next Steps**

## Formatting Quick Reference

```python
# Font
run.font.size = Pt(12)
run.font.color.rgb = RGBColor(0x33, 0x33, 0x33)
run.font.name = 'Calibri'

# Alignment
from docx.enum.text import WD_ALIGN_PARAGRAPH
p.alignment = WD_ALIGN_PARAGRAPH.LEFT  # CENTER, RIGHT, JUSTIFY

# Spacing
from docx.shared import Pt
p.paragraph_format.space_after = Pt(6)
p.paragraph_format.line_spacing = 1.15

# Page break
doc.add_page_break()
```

## Constraints

- python-docx cannot read `.doc` (old format) — convert to .docx first
- Images in existing documents: python-docx can access them but not easily extract
- Complex formatting (nested tables, text boxes) may not render perfectly
- Always test the output file can be opened in Word/LibreOffice
