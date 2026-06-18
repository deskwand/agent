---
name: csv-processor
description: "Process, clean, and analyze CSV files. Use when user asks to work with CSV data, filter rows, aggregate columns, or convert CSV to other formats."
version: 1.0.0
author: omagt
license: MIT
metadata:
  tags: [CSV, Data, Tables, Processing, Cleaning]
allowed-tools: "read,shell,write"
---

# CSV Processor

Work with CSV data: read, clean, filter, transform.

## When to use

- User provides a .csv file and wants to inspect or manipulate it
- User asks to filter rows, select columns, or aggregate data
- User wants to convert between CSV and other formats
- Data cleaning tasks (handle missing values, normalize columns)

---

## Reading & Inspection

```bash
# Quick preview
head -20 file.csv

# Row count
wc -l file.csv

# Column names (first row)
head -1 file.csv | tr ',' '\n' | cat -n

# Structured overview with Python
python3 -c "
import pandas as pd
df = pd.read_csv('file.csv')
print(f'Rows: {len(df)}, Columns: {len(df.columns)}')
print(f'Columns: {list(df.columns)}')
print(f'Dtypes:\n{df.dtypes}')
print(f'Missing:\n{df.isnull().sum()}')
print(f'\nFirst 5 rows:')
print(df.head().to_string())
"
```

---

## Common Operations

### Filter Rows
```bash
python3 -c "
import pandas as pd
df = pd.read_csv('file.csv')
filtered = df[df['Status'] == 'Active']
filtered.to_csv('filtered.csv', index=False)
print(f'Filtered: {len(filtered)} rows (from {len(df)})')
"
```

### Select Columns
```bash
python3 -c "
import pandas as pd
df = pd.read_csv('file.csv')
subset = df[['Name', 'Email', 'Status']]
subset.to_csv('subset.csv', index=False)
"
```

### Aggregate
```bash
python3 -c "
import pandas as pd
df = pd.read_csv('file.csv')
print(df.groupby('Category')['Amount'].agg(['count', 'sum', 'mean']))
"
```

### Sort
```bash
python3 -c "
import pandas as pd
df = pd.read_csv('file.csv')
df.sort_values('Date', ascending=False).to_csv('sorted.csv', index=False)
"
```

### Deduplicate
```bash
python3 -c "
import pandas as pd
df = pd.read_csv('file.csv')
before = len(df)
df = df.drop_duplicates()
print(f'Removed {before - len(df)} duplicates, {len(df)} remaining')
df.to_csv('deduped.csv', index=False)
"
```

---

## Data Cleaning

```bash
python3 -c "
import pandas as pd
df = pd.read_csv('file.csv')

# Strip whitespace from all string columns
for col in df.select_dtypes(include='object'):
    df[col] = df[col].str.strip()

# Fill missing values
df['Name'] = df['Name'].fillna('Unknown')
df['Amount'] = df['Amount'].fillna(0)

# Drop empty rows
df = df.dropna(how='all')

print(f'Cleaned: {len(df)} rows')
df.to_csv('cleaned.csv', index=False)
"
```

---

## Format Conversion

| From | To | Command hint |
|------|----|-------------|
| CSV | JSON | `df.to_json('out.json', orient='records')` |
| CSV | Excel | `df.to_excel('out.xlsx', index=False)` |
| CSV | Markdown | `df.to_markdown()` (with tabulate) |
| JSON | CSV | `pd.read_json('in.json').to_csv('out.csv', index=False)` |

## Constraints

- Large files (>100MB): warn user, suggest chunked processing
- Encoding issues: try `encoding='utf-8-sig'` or `encoding='latin1'`
- Always output the row count change after operations
- Never modify original file unless explicitly requested — save to new file
