---
name: json-yaml-tools
description: "Parse, validate, format, and transform JSON and YAML data. Use when user asks to work with JSON/YAML, validate config files, convert between formats, or extract data."
version: 1.0.0
author: omagt
license: MIT
metadata:
  tags: [JSON, YAML, Data, Parsing, Validation, Transformation]
allowed-tools: "read,write,shell"
---

# JSON & YAML Tools

Work with structured data formats.

## When to use

- User provides JSON/YAML and wants it formatted/validated
- User wants to extract fields from JSON/YAML
- User wants to convert between JSON ↔ YAML
- User asks "is this valid JSON?"
- Config file inspection and validation

---

## Validation

### JSON
```bash
# Validate syntax
python3 -c "import json; json.load(open('file.json')); print('Valid JSON')"

# Or with jq
cat file.json | python3 -m json.tool > /dev/null && echo "Valid" || echo "Invalid"
```

### YAML
```bash
# Validate syntax
python3 -c "import yaml; yaml.safe_load(open('file.yaml')); print('Valid YAML')"
```

---

## Formatting & Pretty-Print

### JSON
```bash
# Pretty-print
python3 -m json.tool file.json

# Compact (minified)
python3 -c "import json; print(json.dumps(json.load(open('file.json')), separators=(',', ':')))"
```

### YAML
```bash
# Convert JSON to YAML
python3 -c "
import json, yaml, sys
data = json.load(open('file.json'))
yaml.dump(data, sys.stdout, default_flow_style=False, allow_unicode=True)
"
```

---

## Data Extraction

### JSON
```bash
# Extract a field (with jq-like Python)
python3 -c "
import json
data = json.load(open('file.json'))
print(data['path']['to']['field'])
"

# List all top-level keys
python3 -c "
import json
data = json.load(open('file.json'))
print('\n'.join(data.keys()) if isinstance(data, dict) else 'Not an object')
"
```

### YAML
```bash
# Extract a specific key
python3 -c "
import yaml
data = yaml.safe_load(open('file.yaml'))
print(data.get('key_name', 'Not found'))
"
```

---

## Conversion

| From | To | Command |
|------|----|---------|
| JSON | YAML | `python3 -c "import json,yaml; yaml.dump(json.load(open('f.json')), ...)"` |
| YAML | JSON | `python3 -c "import json,yaml; json.dump(yaml.safe_load(open('f.yaml')), ...)"` |
| JSON | CSV | Flatten and write manually (structure-dependent) |
| CSV | JSON | Read CSV with csv module, dump as JSON |

---

## Common Patterns

```bash
# Count items in JSON array
python3 -c "import json; print(len(json.load(open('f.json'))))"

# Check if key exists
python3 -c "import json; print('key' in json.load(open('f.json')))"

# Merge two JSON files (shallow)
python3 -c "
import json
a = json.load(open('a.json'))
b = json.load(open('b.json'))
print(json.dumps({**a, **b}, indent=2))
"
```

---

## Constraints

- Always validate before transforming
- Large files (>10MB): use streaming parsers or warn user
- YAML: always use `safe_load` (never `load` — security risk)
- Never modify original files unless user explicitly requests it
