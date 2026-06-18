---
name: shell-script
description: "Safely execute shell commands and scripts. Use when user asks to run a command, execute a script, or perform system operations via terminal."
version: 1.0.0
author: omagt
license: MIT
metadata:
  tags: [Shell, Terminal, CLI, Scripts, System]
allowed-tools: "shell,read"
---

# Shell Script Execution

Execute shell commands safely with risk classification.

## When to use

- User asks to run a specific command
- User wants to check system state (disk, memory, processes)
- User needs to install packages or dependencies
- File operations not covered by `read`/`write` (bulk, recursive)

## Risk Classification

Every `shell` call requires a risk level:

| Level | When | Examples |
|-------|------|----------|
| `low` | Read-only, no side effects | `ls`, `cat`, `git status`, `git diff`, `echo` |
| `medium` | Modifies state but reversible | `mkdir`, `npm install`, `git add`, `git commit` |
| `high` | Destructive or irreversible | `rm -rf`, `git push --force`, `chmod`, system config changes |

**high-risk commands are blocked by default.** Use alternative approaches or get explicit user confirmation.

## Usage

```
shell(
  command="ls -la /path",
  risk_level="low",
  risk_reason="Read-only directory listing"
)
```

## Command Guidelines

### ✅ Safe Patterns

```bash
# Read-only inspection
git status --porcelain
ls -la
cat file.txt
wc -l file.txt

# Version checks
node --version
npm --version

# Build/test (no side effects outside workspace)
npm test
npm run build
```

### ⚠️ Require Caution

```bash
# State changes — always confirm with user first
git commit -m "message"     # confirm message
npm install <package>       # confirm package name
rm file.txt                 # confirm file path
```

### 🚫 Never Do

- `rm -rf` without explicit confirmation
- `git push --force` to shared branches
- `chmod 777` or permission escalation
- Pipe `curl` output directly to shell
- Execute obfuscated or encoded commands

## Script File Handling

When user provides a script file:
1. `read` the file first — understand what it does
2. Check for dangerous patterns (rm -rf, curl | sh, sudo)
3. Classify risk level
4. Execute with appropriate risk_level
5. Report output with exit code

## Multi-line Scripts

```bash
cd /path/to/project \
  && npm run lint \
  && npm test
```

Chain with `&&` so failures stop execution. Never use `;` for dependent commands.

## Platform Awareness

- macOS (default): `sh` or `zsh`
- Check platform-specific commands: `brew` vs `apt-get`, `open` vs `xdg-open`
- Use cross-platform alternatives where possible

## Constraints

- Never bypass risk checks with `--no-verify`, `--force`, or similar flags
- Report exit codes explicitly
- If a command hangs, report timeout rather than leaving it running
