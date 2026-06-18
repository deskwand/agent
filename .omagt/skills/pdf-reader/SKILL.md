---
name: pdf-reader
description: "Extract text from PDFs and scanned documents, split/merge/search PDFs. Use when user provides a PDF file or asks to read/extract PDF content."
version: 1.0.0
author: omagt (adapted from Hermes Agent ocr-and-documents)
license: MIT
metadata:
  source: adapted from Hermes Agent ocr-and-documents v2.3.0
  tags: [PDF, Documents, Text-Extraction, OCR]
allowed-tools: "read,shell,web_fetch,ocr_image,tool_gateway"
---

# PDF Reader & Document Extraction

For DOCX/PPTX: see `docx-generator` and `pptx-creator` skills. This skill covers **PDFs and scanned documents**.

## Step 1: Remote URL Available?

If the document has a URL, try `web_fetch` first:
```
web_fetch(url="https://example.com/report.pdf")
```

Only use local extraction when: the file is local, web_fetch fails, or you need batch processing.

## Step 2: Local PDF Reading

omagt provides two paths for local PDFs:

### Path A — read_document (preferred)
Use `tool_gateway(action=call_tool, category=doc, tool_name=read_document, arguments={"file_path":"/path/to/file.pdf"})`. 
Handles text-based PDFs with automatic OCR fallback for scanned documents.

### Path B — shell with pymupdf (fallback)
```bash
pip install pymupdf pymupdf4llm
python3 -c "
import pymupdf
doc = pymupdf.open('document.pdf')
for page in doc:
    print(page.get_text())
"
```

## Step 3: OCR for Scanned PDFs / Images

If the PDF is image-based (scanned), use `ocr_image`:
```
ocr_image(image_source="/path/to/scanned.pdf", type="general")
```

For batch pages, extract pages as images first, then OCR each.

## Split, Merge & Search

```bash
# Split: extract pages 1-5
python3 -c "
import pymupdf
doc = pymupdf.open('report.pdf')
new = pymupdf.open()
for i in range(5):
    new.insert_pdf(doc, from_page=i, to_page=i)
new.save('pages_1-5.pdf')
"

# Merge multiple PDFs
python3 -c "
import pymupdf
result = pymupdf.open()
for path in ['a.pdf', 'b.pdf', 'c.pdf']:
    result.insert_pdf(pymupdf.open(path))
result.save('merged.pdf')
"

# Search text across all pages
python3 -c "
import pymupdf
doc = pymupdf.open('report.pdf')
for i, page in enumerate(doc):
    results = page.search_for('revenue')
    if results:
        print(f'Page {i+1}: {len(results)} match(es)')
"
```

## Notes

- `web_fetch` is first choice for URLs
- `read_document` (via tool_gateway) is the primary local reader — handles both text and OCR
- pymupdf is the lightweight fallback for shell-based processing
- For Word docs: see `docx-generator` skill
- For PowerPoint: see `pptx-creator` skill
