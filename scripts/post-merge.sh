#!/bin/bash
set -e

npm install
npm run build

# Ensure ~/.claude/ is wired up to the workspace-tracked hook scripts and
# settings so that Claude's PreToolUse enforcement is active in every session.
HOOKS_SRC="/home/runner/workspace/hooks"
HOOKS_DST="$HOME/.claude/hooks"
mkdir -p "$HOOKS_DST"

# Symlink each hook script into ~/.claude/hooks/ so settings.json can use
# stable, environment-agnostic paths.
for src in "$HOOKS_SRC"/tt-*.py "$HOOKS_SRC"/tt-*.sh; do
    [ -e "$src" ] || continue
    dst="$HOOKS_DST/$(basename "$src")"
    if [ ! -L "$dst" ] || [ "$(readlink "$dst")" != "$src" ]; then
        ln -sf "$src" "$dst"
    fi
done

# Symlink settings.json from the workspace-tracked canonical copy.
SETTINGS_TARGET="/home/runner/workspace/.claude/settings.json"
SETTINGS_LINK="$HOME/.claude/settings.json"
if [ ! -L "$SETTINGS_LINK" ] || [ "$(readlink "$SETTINGS_LINK")" != "$SETTINGS_TARGET" ]; then
    ln -sf "$SETTINGS_TARGET" "$SETTINGS_LINK"
fi
