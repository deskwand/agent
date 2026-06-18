---
name: image-ocr
description: "Extract text from images using OCR. Use when user provides an image and wants to extract text: screenshots, scanned documents, invoices, receipts, business cards, ID cards."
version: 1.0.0
author: omagt
license: MIT
metadata:
  tags: [OCR, Images, Text-Extraction, Documents, Invoices, Screenshots]
allowed-tools: "ocr_image,read,tool_gateway"
---

# Image OCR

Extract text from images. Covers 40+ document types.

## When to use

- User provides an image and asks "what does this say?"
- Screenshots with text to extract
- Scanned documents, invoices, receipts
- Business cards, ID cards, bank cards, license plates
- PDF pages rendered as images

## Usage

```
ocr_image(image_source="/path/to/image.png", type="general")
```

### Supported Types

| Type | Use for |
|------|---------|
| `general` | Any image with text (default) |
| `idcard` | ID cards, driver's licenses |
| `bankcard` | Bank cards |
| `business_license` | Business licenses |
| `invoice` | Invoices, receipts |
| `passport` | Passports |
| `vehicle_license` | Vehicle license plates |

## Workflow

1. **Identify the document type** — helps pick the right OCR type
2. **Run OCR**: `ocr_image(image_source=..., type=...)`
3. **Review output**: Check for recognition errors (especially numbers, special characters)
4. **Structure the data**: If invoice/receipt, present line items + totals. If business card, present name/title/contact.

## For PDFs with Images

If a PDF contains scanned pages (image-based), extract pages as images first, then OCR each:
1. Use `read_document` first — it has built-in OCR fallback
2. If that fails, use `shell` to convert PDF pages to images, then `ocr_image` each

## Constraints

- OCR accuracy varies by image quality — flag uncertain characters
- For multi-page documents, process page by page
- Never infer or fabricate text that isn't clearly visible in the image
- For handwritten text: note that recognition may be unreliable
