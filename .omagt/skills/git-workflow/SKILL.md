---
name: git-workflow
description: "Complete Git workflow: branch, commit, PR lifecycle, CI monitoring, auto-fix, merge. Use when user asks to commit, push, create a PR, or fix CI failures."
version: 1.0.0
author: omagt (adapted from Hermes Agent github-pr-workflow)
license: MIT
metadata:
  source: adapted from Hermes Agent github-pr-workflow v1.1.0
  tags: [Git, GitHub, Pull-Requests, CI/CD, Automation]
allowed-tools: "read,shell,edit,write"
---

# Git Workflow

Complete PR lifecycle management. Uses plain `git` everywhere — `gh` CLI is optional.

## Prerequisites

- Inside a git repository with a remote
- `gh` CLI optional (preferred for PR interactions; falls back to `git` + `curl`)

---

## 1. Branch Creation

```bash
git fetch origin
git checkout main && git pull origin main
git checkout -b feat/description
```

Branch naming: `feat/`, `fix/`, `refactor/`, `docs/`, `ci/`, `chore/`

## 2. Making Commits

Use Conventional Commits format:
```
type(scope): short description

Longer explanation if needed. Wrap at 72 chars.
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `ci`, `chore`, `perf`

See [references/conventional-commits.md](references/conventional-commits.md) for full spec.

## 3. Pushing and Creating a PR

```bash
git push -u origin HEAD

# With gh
gh pr create --title "feat: description" --body "## Summary..."

# With git + curl (see SKILL.md from source for fallback)
```

## 4. Monitoring CI

```bash
# With gh
gh pr checks
gh pr checks --watch

# Plain git: check status of latest commit
git rev-parse HEAD  # get SHA
# Then use GitHub REST API for commit status
```

See [references/ci-troubleshooting.md](references/ci-troubleshooting.md) for diagnosing common CI failures.

## 5. Auto-Fixing CI Failures

1. Check CI status → identify failures
2. Read failure logs → understand the error
3. Use `read` + `edit` → fix the code
4. `git add . && git commit -m "fix: ..." && git push`
5. Re-check CI → repeat if needed (max 3 attempts, then ask user)

## 6. Merging

```bash
# Squash merge (cleanest for feature branches)
gh pr merge --squash --delete-branch

# Enable auto-merge
gh pr merge --auto --squash --delete-branch
```

## Complete Workflow Example

```bash
git checkout main && git pull origin main
git checkout -b fix/login-bug
# (make changes with edit tool)
git add src/auth/login.ts tests/
git commit -m "fix: correct redirect URL after login"
git push -u origin HEAD
gh pr create --title "fix: correct redirect URL after login" --body "..."
gh pr checks --watch
gh pr merge --squash --delete-branch
```

## Useful Commands

| Action | Command |
|--------|---------|
| List my PRs | `gh pr list --author @me` |
| View PR diff | `gh pr diff 123` |
| Check out PR | `gh pr checkout 123` |
| Request review | `gh pr edit 123 --add-reviewer user` |
| Close PR | `gh pr close 123` |
