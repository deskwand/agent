---
name: regex-tester
description: "Create, test, and debug regular expressions. Use when user asks to write a regex, test a pattern against text, or debug why a regex isn't matching."
version: 1.0.0
author: omagt
license: MIT
metadata:
  tags: [Regex, Regular Expressions, Pattern, Matching, Text]
allowed-tools: "read,shell,grep"
---

# Regex Tester

Create and test regular expressions interactively.

## When to use

- User asks to "write a regex for..."
- User has a regex that isn't working as expected
- User wants to extract specific patterns from text
- User asks to validate email/phone/URL formats

---

## Quick Test (Shell)

```bash
# Test if regex matches
echo "test string" | grep -oP 'pattern'

# Extract matches
echo "abc123def456" | grep -oP '\d+'
# Output:
# 123
# 456

# Count matches
echo "abc123def456ghi789" | grep -oP '\d+' | wc -l

# Show matching lines with context
grep -nP 'pattern' file.txt
```

---

## Common Patterns

### Validation Patterns

| Pattern | Regex | Notes |
|---------|-------|-------|
| Email | `^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$` | Simplified; RFC 5322 is more complex |
| URL | `https?://[^\s/$.?#].[^\s]*` | Basic; consider `urllib.parse` for robust parsing |
| IPv4 | `^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$` | Does not validate ranges (0-255) |
| Date (YYYY-MM-DD) | `^\d{4}-(0[1-9]\|1[0-2])-(0[1-9]\|[12]\d\|3[01])$` | Does not validate month-day combos |
| Phone (Chinese) | `^1[3-9]\d{9}$` | 11-digit mobile |
| SemVer | `^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$` | |

### Extraction Patterns

| Pattern | Regex |
|---------|-------|
| Numbers | `\d+` (integers), `\d+\.\d+` (decimals) |
| Words | `\b\w+\b` |
| Quoted strings | `"([^"]*)"` or `'([^']*)'` |
| HTML tags | `<(\w+)[^>]*>(.*?)</\1>` |
| Markdown links | `\[([^\]]+)\]\(([^)]+)\)` |
| Hex color | `#([0-9a-fA-F]{6}\|[0-9a-fA-F]{3})` |

---

## Python Test Script

For complex regex debugging:

```bash
python3 -c "
import re

pattern = r'<your regex>'
tests = [
    ('should match', True),
    ('should not', False),
]

for text, expected in tests:
    result = bool(re.search(pattern, text))
    status = '✅' if result == expected else '❌'
    print(f'{status} \"{text}\" -> {result} (expected {expected})')
"
```

## Regex Syntax Quick Reference

| Element | Meaning |
|---------|---------|
| `.` | Any character except newline |
| `*` | 0 or more |
| `+` | 1 or more |
| `?` | 0 or 1 |
| `{n}` | Exactly n |
| `{n,}` | n or more |
| `{n,m}` | n to m |
| `^` | Start of string/line |
| `$` | End of string/line |
| `\b` | Word boundary |
| `\d` | Digit |
| `\w` | Word character |
| `\s` | Whitespace |
| `[abc]` | Character class |
| `[^abc]` | Negated class |
| `(a\|b)` | Alternation |
| `(...)` | Capturing group |
| `(?:...)` | Non-capturing group |
| `(?=...)` | Lookahead |
| `(?<=...)` | Lookbehind |

### Flags

| Flag | Python | grep -P |
|------|--------|---------|
| Case-insensitive | `re.IGNORECASE` / `(?i)` | `grep -iP` |
| Multiline (^/$ match line boundaries) | `re.MULTILINE` / `(?m)` | N/A |
| Dot matches newline | `re.DOTALL` / `(?s)` | N/A |

## Debugging Tips

1. **Too greedy**: Use `.*?` instead of `.*`
2. **No match**: Check if you need `^`/`$` anchors or word boundaries `\b`
3. **Unexpected matches**: Make the pattern more specific; avoid overly broad `.*`
4. **Performance**: Avoid nested quantifiers like `(.*)*` — catastrophic backtracking risk
5. **Test edge cases**: empty string, max length input, special characters, unicode

## Constraints

- For production validation of emails/URLs, use dedicated parsers, not regex alone
- Never use user-provided regex directly without validation (ReDoS risk)
- Test with grep first, then with the target language's regex engine (dialects differ slightly)
