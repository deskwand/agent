# Vendored officecli skills

These SKILL.md files are vendored from officecli **v1.0.150** so the app's skill
list carries the trigger words (`Word doc`, `report`, `deck`, `spreadsheet`, …).
Without a local copy the model would only see the generic base description and
triggering would get noticeably worse.

They are **not** the source of truth for content. The authoritative copies live
inside the pinned binary and are served by `officecli load_skill <name>`, which
also covers the seven scene skills (academic-paper, pitch-deck, financial-model,
data-dashboard, word-form, morph-ppt, morph-ppt-3d) that are deliberately not
vendored here.

## Regenerating after a version bump

1. Bump `OFFICECLI_VERSION` in `scripts/prepare-bin.js` (and the sha256 values).
2. Regenerate the upstream copies:

   ```bash
   rm -rf /tmp/ocli-skills && mkdir -p /tmp/ocli-skills
   HOME=/tmp/ocli-skills officecli skills claude
   HOME=/tmp/ocli-skills officecli skills install word claude
   HOME=/tmp/ocli-skills officecli skills install pptx claude
   HOME=/tmp/ocli-skills officecli skills install excel claude
   cp -R /tmp/ocli-skills/.claude/skills/officecli* .deskwand/skills/
   ```

3. **Re-apply the local `## Setup` / `## Install` rewrite.** The upstream text
   tells the agent to `curl … | bash` when officecli is missing. That is wrong
   here: the binary ships with the app and is already on PATH, and a second
   install would shadow the pinned build and break the offline guarantee. A
   plain re-copy loses this rewrite — see the "Never install it" paragraph in
   each file.

## Why not vendor the scene skills too

Vendoring is for *triggering*, and the three format skills already cover the
common trigger words. The scene skills add ~2.1MB (mostly morph-ppt's 52-style
library) and are reachable through the base skill's `Specialized Skills` routing
table via `officecli load_skill`. Revisit only if they turn out to trigger too
rarely in practice.
