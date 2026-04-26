#!/usr/bin/env bash
# PreToolUse hook: tt-require-dry-run
# Fires on: create_order, create_complex_order
#
# When TT_DRY_RUN=1 is set in the environment, all order-creation tool calls
# are blocked. Use this to run Claude in a safe analysis-only mode where
# no live orders can accidentally be submitted.
#
# To enable dry-run mode:
#   export TT_DRY_RUN=1
#
# To disable and allow live orders:
#   unset TT_DRY_RUN

set -euo pipefail

WATCHED_TOOLS=("create_order" "create_complex_order")

tool_name=$(python3 -c "
import json, sys
data = json.load(sys.stdin)
print(data.get('tool_name', ''))
")

matched=0
for t in "${WATCHED_TOOLS[@]}"; do
    if [[ "$tool_name" == "$t" ]]; then
        matched=1
        break
    fi
done

if [[ $matched -eq 0 ]]; then
    exit 0
fi

if [[ "${TT_DRY_RUN:-0}" == "1" ]]; then
    echo "BLOCKED -- dry-run mode is active (TT_DRY_RUN=1)."
    echo ""
    echo "No live orders will be submitted while dry-run mode is enabled."
    echo "To place real orders, unset TT_DRY_RUN or set TT_DRY_RUN=0 in your"
    echo "shell environment and restart Claude."
    exit 2
fi

exit 0
