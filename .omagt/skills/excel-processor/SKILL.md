---
name: excel-processor
description: "Read, analyze, and manipulate Excel (.xlsx/.xls) files. Use when user provides an Excel file or asks to work with spreadsheet data."
version: 1.0.0
author: omagt
license: MIT
metadata:
  tags: [Excel, Spreadsheet, xlsx, Data, Tables]
allowed-tools: "read,shell,tool_gateway"
---

# Excel Processor

Work with Excel spreadsheets — read, analyze, extract, and transform data.

## When to use

- User provides an .xlsx/.xls file
- User asks to "read this spreadsheet" or "analyze this Excel file"
- User wants to extract data from Excel into another format
- User wants to see what's in a spreadsheet before deciding next steps

## Reading Excel Files

### Path A — read_document (preferred)
```
tool_gateway(action=call_tool, category=doc, tool_name=read_document, arguments={"file_path":"/path/to/file.xlsx"})
```
Handles most .xlsx files with automatic table extraction.

### Path B — Python (shell fallback)

```bash
# Install dependency (once)
pip install openpyxl pandas

# List sheet names
python3 -c "
import openpyxl
wb = openpyxl.load_workbook('file.xlsx', data_only=True)
print('Sheets:', wb.sheetnames)
"

# Read a sheet
python3 -c "
import pandas as pd
df = pd.read_excel('file.xlsx', sheet_name='Sheet1')
print(f'Rows: {len(df)}, Columns: {len(df.columns)}')
print(df.head(20).to_string())
"

# Read with specific options
python3 -c "
import pandas as pd
df = pd.read_excel('file.xlsx', sheet_name=0, header=1, skiprows=2, nrows=100)
print(df.to_string())
"
```

## Common Operations

### Get Overview
```bash
python3 -c "
import pandas as pd
df = pd.read_excel('file.xlsx')
print(f'Shape: {df.shape}')
print(f'Columns: {list(df.columns)}')
print(f'Dtypes:\n{df.dtypes}')
print(f'Missing values:\n{df.isnull().sum()}')
"
```

### Filter & Query
```bash
python3 -c "
import pandas as pd
df = pd.read_excel('file.xlsx')
# Filter rows where column 'Status' == 'Active'
filtered = df[df['Status'] == 'Active']
print(filtered.to_string())
"
```

### Convert to CSV
```bash
python3 -c "
import pandas as pd
df = pd.read_excel('file.xlsx')
df.to_csv('output.csv', index=False)
print('Converted to output.csv')
"
```

### Statistical Summary
```bash
python3 -c "
import pandas as pd
df = pd.read_excel('file.xlsx')
print(df.describe())
"
```

## Constraints

- `.xls` (old format) may need `xlrd` instead of `openpyxl`
- Large files (>50MB): warn user, process in chunks
- Password-protected files: cannot read — inform user
- Always use `data_only=True` to get computed values, not formulas
- For .xlsm (macro-enabled): macros are not executed, values read as-is
