#!/usr/bin/env python3
"""
PreToolUse hook: tt-require-plan
Fires on: create_order, create_complex_order

Checks /tmp/tt_pending_plan.json for a trade plan with all five required
fields. If the file is missing, incomplete, or older than 60 minutes,
the order is blocked with instructions to write the plan file.

Required plan fields:
  - thesis:         Why you are entering this trade
  - profit_target:  The price or P&L level at which you take profit
  - stop_loss:      The price or P&L level at which you exit for a loss
  - time_stop:      The date or DTE at which you exit regardless of P&L
  - invalidation:   The condition that would prove your thesis wrong
"""

import json
import os
import sys
import time

WATCHED_TOOLS = {"create_order", "create_complex_order"}
PLAN_FILE = "/tmp/tt_pending_plan.json"
MAX_AGE_SECONDS = 60 * 60
REQUIRED_FIELDS = ["thesis", "profit_target", "stop_loss", "time_stop", "invalidation"]


def validate_plan():
    """
    Returns (ok, reason) where ok is True if the plan is valid, False otherwise.
    """
    if not os.path.exists(PLAN_FILE):
        return False, (
            "plan file not found at {}\n\n"
            "Create the file before submitting any order. Example:\n\n"
            "  cat > {file} << 'EOF'\n"
            "  {{\n"
            '    "thesis":        "IV rank >50, selling premium into elevated vol",\n'
            '    "profit_target": "50% of credit received (~$X)",\n'
            '    "stop_loss":     "2x credit received (~$X)",\n'
            '    "time_stop":     "21 DTE or {date}",\n'
            '    "invalidation":  "underlying breaks above/below $X"\n'
            "  }}\n"
            "  EOF"
        ).format(PLAN_FILE, file=PLAN_FILE, date="<date>")

    try:
        stat = os.stat(PLAN_FILE)
        age_seconds = time.time() - stat.st_mtime
        if age_seconds > MAX_AGE_SECONDS:
            age_minutes = int(age_seconds // 60)
            return False, (
                "plan file is {age} minutes old (max allowed: 60 minutes).\n"
                "Rewrite {file} with a fresh plan before submitting.".format(
                    age=age_minutes, file=PLAN_FILE
                )
            )
    except OSError as e:
        return False, "cannot stat plan file: {}".format(e)

    try:
        with open(PLAN_FILE) as f:
            plan = json.load(f)
    except json.JSONDecodeError as e:
        return False, "plan file is not valid JSON: {}. Fix and rewrite it.".format(e)

    missing = []
    empty = []
    for field in REQUIRED_FIELDS:
        if field not in plan:
            missing.append(field)
        elif not str(plan[field]).strip():
            empty.append(field)

    problems = []
    if missing:
        problems.append("missing fields: {}".format(", ".join(missing)))
    if empty:
        problems.append("empty fields: {}".format(", ".join(empty)))

    if problems:
        return False, (
            "plan file is incomplete -- {}.\n\n"
            "All five fields are required:\n"
            "  thesis, profit_target, stop_loss, time_stop, invalidation\n\n"
            "Update {} and resubmit.".format("; ".join(problems), PLAN_FILE)
        )

    return True, ""


def main():
    try:
        hook_input = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print("tt-require-plan: failed to parse hook input: {}".format(e), file=sys.stderr)
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    if tool_name not in WATCHED_TOOLS:
        sys.exit(0)

    ok, reason = validate_plan()

    if ok:
        sys.exit(0)

    print(
        "BLOCKED -- no valid pre-trade plan found.\n\n"
        "{reason}\n\n"
        "Write a plan to {file} covering all five fields before placing any order.".format(
            reason=reason, file=PLAN_FILE
        )
    )
    sys.exit(2)


if __name__ == "__main__":
    main()
