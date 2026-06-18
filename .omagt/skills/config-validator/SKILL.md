---
name: config-validator
description: "Validate configuration files for syntax correctness and best practices. Use when user asks to check config files, validate YAML/JSON/TOML syntax, or audit configuration security."
version: 1.0.0
author: omagt
license: MIT
metadata:
  tags: [Config, Validation, YAML, JSON, TOML, Security, Audit]
allowed-tools: "read,shell,glob,grep"
---

# Config Validator

Check configuration files for errors and security issues.

## When to use

- User asks "is my config file valid?"
- User wants to audit configs for security issues (secrets, misconfigurations)
- User has a CI failure related to config parsing
- User asks to check project configuration across multiple files

---

## Validation by Format

### YAML (.yml, .yaml)

```bash
# Syntax validation
python3 -c "import yaml; yaml.safe_load(open('config.yml')); print('Valid YAML')"

# Check for common issues
python3 -c "
import yaml
data = yaml.safe_load(open('config.yml'))
# Check for duplicate keys (yaml silently uses last value)
# Check indentation consistency
print(f'Top-level keys: {list(data.keys())}')
"
```

### JSON (.json)

```bash
# Syntax validation
python3 -m json.tool config.json > /dev/null && echo "Valid" || echo "Invalid"

# Check for trailing commas, duplicate keys
```

### TOML (.toml)

```bash
# Python 3.11+
python3 -c "import tomllib; tomllib.load(open('config.toml', 'rb')); print('Valid TOML')"

# Older Python: pip install tomli
python3 -c "import tomli; tomli.load(open('config.toml', 'rb')); print('Valid TOML')"
```

### .env files

```bash
# Check for missing values, unquoted special chars
grep -n '=$' .env && echo "⚠️ Lines with empty values"
grep -n '=.*#' .env && echo "⚠️ Possible inline comments (not supported in .env)"
```

---

## Security Audit

### Scan for Hardcoded Secrets

```bash
# High-confidence patterns
grep -rn --include="*.{yml,yaml,json,toml,env,ini,conf}" \
  -E "(password|secret|api_key|token|private_key)\s*[:=]\s*['\"][^'\"]{6,}['\"]" .

# Broader scan (more false positives)
grep -rn --include="*.{yml,yaml,json,toml}" \
  -iE "(password|secret|token|key|credential)" .
```

### Check for Common Misconfigurations

```bash
# Docker: privileged mode
grep -rn "privileged:\s*true" docker-compose*.yml

# Kubernetes: hostNetwork, hostPID
grep -rn "hostNetwork:\s*true\|hostPID:\s*true" *.yaml

# CORS: wildcard origins in production
grep -rn "Access-Control-Allow-Origin:\s*\*" .
```

---

## Structural Validation

### Docker Compose
```bash
docker compose config --quiet  # validates and normalizes
```

### GitHub Actions
```bash
# Check workflow syntax via GitHub API
gh api repos/OWNER/REPO/actions/workflows/main.yml/dispatches 2>&1
```

### package.json
```bash
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('Valid')"
```

---

## Validation Checklist

When auditing project configs, check:

- [ ] All config files parse without errors
- [ ] No hardcoded secrets or credentials
- [ ] File permissions are appropriate (not world-readable for secrets)
- [ ] Production vs development configs are separated
- [ ] Default values are safe (not debug=true in production)
- [ ] External URLs use HTTPS
- [ ] Port numbers don't conflict
- [ ] Resource limits are reasonable (no unlimited memory/cpu)

## Constraints

- Never log or display detected secrets — report "found at line X" only
- If `.env` is found in the scan target, warn user it should be in `.gitignore`
- Don't modify config files during audit — report findings only
