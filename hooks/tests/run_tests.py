#!/usr/bin/env python3
"""
Integration test runner for TastyTrade pre-trade enforcement hooks.

Feeds real-shaped TastyTrade order payloads through each hook and asserts the
expected exit code (0 = allow, 2 = block).

Usage:
    python hooks/tests/run_tests.py          # run all tests, human-readable output
    python hooks/tests/run_tests.py --json   # machine-readable JSON summary

The runner sets up the required sidecar files in /tmp before each test:
  /tmp/tt_pending_plan.json   — required by tt-require-plan
  /tmp/tt_netliq.json         — required by tt-concentration-cap
  /tmp/tt_positions.json      — required by tt-concentration-cap and tt-ff-exit-monitor
"""

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HOOKS_DIR = Path(__file__).parent.parent
FIXTURES_DIR = Path(__file__).parent / "fixtures"

HOOKS = {
    "tt-require-bracket":     str(HOOKS_DIR / "tt-require-bracket.py"),
    "tt-concentration-cap":   str(HOOKS_DIR / "tt-concentration-cap.py"),
    "tt-require-plan":        str(HOOKS_DIR / "tt-require-plan.py"),
    "tt-ff-exit-monitor":     str(HOOKS_DIR / "tt-ff-exit-monitor.py"),
}

PLAN_FILE     = "/tmp/tt_pending_plan.json"
NETLIQ_FILE   = "/tmp/tt_netliq.json"
POSITIONS_FILE = "/tmp/tt_positions.json"


# ---------------------------------------------------------------------------
# Sidecar helpers
# ---------------------------------------------------------------------------

VALID_PLAN = {
    "thesis":        "IV rank > 50, selling premium into elevated vol",
    "profit_target": "50% of credit received",
    "stop_loss":     "2x credit received",
    "time_stop":     "21 DTE",
    "invalidation":  "underlying breaks outside the expected range",
}

def write_plan(data=None, age_seconds=0):
    payload = data if data is not None else VALID_PLAN
    path = Path(PLAN_FILE)
    path.write_text(json.dumps(payload))
    if age_seconds:
        new_mtime = time.time() - age_seconds
        os.utime(path, (new_mtime, new_mtime))

def remove_plan():
    Path(PLAN_FILE).unlink(missing_ok=True)

def write_netliq(value=100_000):
    Path(NETLIQ_FILE).write_text(json.dumps({"net-liquidating-value": value}))

def remove_netliq():
    Path(NETLIQ_FILE).unlink(missing_ok=True)

def write_positions(positions=None):
    items = positions if positions is not None else []
    Path(POSITIONS_FILE).write_text(json.dumps(items))

def remove_positions():
    Path(POSITIONS_FILE).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Hook runner
# ---------------------------------------------------------------------------

def run_hook(hook_name, fixture_path, *, env=None):
    """Run a hook with the given fixture JSON on stdin. Returns (exit_code, stdout, stderr)."""
    hook_path = HOOKS[hook_name]
    payload = fixture_path.read_text()
    fixture_data = json.loads(payload)
    # Strip _comment keys before feeding to the hook
    clean = {k: v for k, v in fixture_data.items() if not k.startswith("_")}
    result = subprocess.run(
        [sys.executable, hook_path],
        input=json.dumps(clean),
        capture_output=True,
        text=True,
        env={**os.environ, **(env or {})},
    )
    return result.returncode, result.stdout.strip(), result.stderr.strip()


# ---------------------------------------------------------------------------
# Test definitions
# ---------------------------------------------------------------------------

class Test:
    def __init__(
        self,
        name,
        fixture,
        hook,
        expected_exit,
        setup=None,
        teardown=None,
        note="",
        stdout_contains=None,
        stdout_absent=None,
    ):
        self.name = name
        self.fixture = FIXTURES_DIR / fixture
        self.hook = hook
        self.expected_exit = expected_exit
        self.setup = setup or (lambda: None)
        self.teardown = teardown or (lambda: None)
        self.note = note
        self.stdout_contains = stdout_contains
        self.stdout_absent = stdout_absent

    def run(self):
        self.setup()
        try:
            code, stdout, stderr = run_hook(self.hook, self.fixture)
        finally:
            self.teardown()
        passed = code == self.expected_exit
        if passed and self.stdout_contains is not None:
            passed = self.stdout_contains in stdout
        if passed and self.stdout_absent is not None:
            passed = self.stdout_absent not in stdout
        return {
            "name": self.name,
            "fixture": self.fixture.name,
            "hook": self.hook,
            "expected": self.expected_exit,
            "got": code,
            "passed": passed,
            "stdout": stdout,
            "stderr": stderr,
            "note": self.note,
        }


def make_tests():
    def plan_on():
        write_plan()

    def plan_off():
        remove_plan()

    def cap_files_ok():
        write_netliq(100_000)
        write_positions([])

    def cap_files_low_netliq_spy_near_cap():
        # netliq=$10,000 → cap=$2,500; existing SPY exposure=$2,300
        # strangle order adds $5.50*1*100=$550 → projected=$2,850 > cap
        write_netliq(10_000)
        write_positions([
            {
                "underlying-symbol": "SPY",
                "instrument-type": "Equity Option",
                "average-open-price": 2.30,
                "quantity": 10,
                "multiplier": 100,
            }
        ])

    def cap_files_cleanup():
        remove_netliq()
        remove_positions()

    def plan_and_cap_ok():
        plan_on()
        cap_files_ok()

    def plan_and_cap_low_spy():
        plan_on()
        cap_files_low_netliq_spy_near_cap()

    def plan_and_cap_cleanup():
        plan_off()
        cap_files_cleanup()

    return [
        # ------------------------------------------------------------------
        # naked_short — single STO call, no bracket, create_order
        # ------------------------------------------------------------------
        Test(
            name="naked_short / tt-require-bracket → BLOCK (no OTOCO)",
            fixture="naked_short.json",
            hook="tt-require-bracket",
            expected_exit=2,
            setup=plan_on,
            teardown=plan_off,
            note="Single STO leg with no bracket must be blocked.",
        ),
        Test(
            name="naked_short / tt-require-plan (no plan) → BLOCK",
            fixture="naked_short.json",
            hook="tt-require-plan",
            expected_exit=2,
            setup=plan_off,
            teardown=lambda: None,
            note="Plan file absent — order must be blocked.",
        ),
        Test(
            name="naked_short / tt-require-plan (valid plan) → ALLOW",
            fixture="naked_short.json",
            hook="tt-require-plan",
            expected_exit=0,
            setup=plan_on,
            teardown=plan_off,
            note="Plan file present — plan hook allows (bracket hook handles blocking separately).",
        ),
        Test(
            name="naked_short / tt-concentration-cap → ALLOW (not watched: create_order)",
            fixture="naked_short.json",
            hook="tt-concentration-cap",
            expected_exit=0,
            setup=lambda: None,
            teardown=lambda: None,
            note="concentration-cap only watches create_complex_order; create_order passes through.",
        ),

        # ------------------------------------------------------------------
        # bracketed_strangle — OTOCO strangle, valid 50%/2x bracket
        # ------------------------------------------------------------------
        Test(
            name="bracketed_strangle / tt-require-bracket → ALLOW (valid OTOCO 50%/2x)",
            fixture="bracketed_strangle.json",
            hook="tt-require-bracket",
            expected_exit=0,
            setup=plan_on,
            teardown=plan_off,
            note="OTOCO with profit at $2.75 (50% of $5.50) and stop at $11.00 (2x $5.50) — within allowed range.",
        ),
        Test(
            name="bracketed_strangle / tt-require-plan (valid plan) → ALLOW",
            fixture="bracketed_strangle.json",
            hook="tt-require-plan",
            expected_exit=0,
            setup=plan_on,
            teardown=plan_off,
        ),
        Test(
            name="bracketed_strangle / tt-concentration-cap (within limits) → ALLOW",
            fixture="bracketed_strangle.json",
            hook="tt-concentration-cap",
            expected_exit=0,
            setup=plan_and_cap_ok,
            teardown=plan_and_cap_cleanup,
            note="$5.50*1*100=$550 notional; netliq=$100k cap=$25k — well within limits.",
        ),
        Test(
            name="bracketed_strangle / tt-require-plan (stale plan) → BLOCK",
            fixture="bracketed_strangle.json",
            hook="tt-require-plan",
            expected_exit=2,
            setup=lambda: write_plan(age_seconds=3700),
            teardown=plan_off,
            note="Plan older than 60 minutes must be rejected.",
        ),

        # ------------------------------------------------------------------
        # put_spread — defined-risk credit put spread (not naked)
        # ------------------------------------------------------------------
        Test(
            name="put_spread / tt-require-bracket → ALLOW (defined-risk spread)",
            fixture="put_spread.json",
            hook="tt-require-bracket",
            expected_exit=0,
            setup=plan_on,
            teardown=plan_off,
            note="BTO qty (1) == STO qty (1) — fully hedged; no naked exposure.",
        ),
        Test(
            name="put_spread / tt-require-plan (valid plan) → ALLOW",
            fixture="put_spread.json",
            hook="tt-require-plan",
            expected_exit=0,
            setup=plan_on,
            teardown=plan_off,
        ),
        Test(
            name="put_spread / tt-concentration-cap (within limits) → ALLOW",
            fixture="put_spread.json",
            hook="tt-concentration-cap",
            expected_exit=0,
            setup=plan_and_cap_ok,
            teardown=plan_and_cap_cleanup,
            note="$1.50*1*100=$150 notional; netliq=$100k — well within 25% cap.",
        ),

        # ------------------------------------------------------------------
        # futures_option_otoco — /ES futures-option OTOCO
        # ------------------------------------------------------------------
        Test(
            name="futures_option_otoco / tt-require-bracket → ALLOW (valid OTOCO 50%/2x, Future Option)",
            fixture="futures_option_otoco.json",
            hook="tt-require-bracket",
            expected_exit=0,
            setup=plan_on,
            teardown=plan_off,
            note="Future Option instrument-type recognised as option; OTOCO with $12.50 profit (50%) and $50.00 stop (2x $25) passes.",
        ),
        Test(
            name="futures_option_otoco / tt-require-plan (valid plan) → ALLOW",
            fixture="futures_option_otoco.json",
            hook="tt-require-plan",
            expected_exit=0,
            setup=plan_on,
            teardown=plan_off,
        ),
        Test(
            name="futures_option_otoco / tt-concentration-cap (within limits) → ALLOW",
            fixture="futures_option_otoco.json",
            hook="tt-concentration-cap",
            expected_exit=0,
            setup=plan_and_cap_ok,
            teardown=plan_and_cap_cleanup,
            note="OTOCO trigger-order legs must be read (not just top-level legs) — verifies the trigger-order fix.",
        ),

        # ------------------------------------------------------------------
        # over_concentrated_strangle — OTOCO that exceeds 25% cap
        # ------------------------------------------------------------------
        Test(
            name="over_concentrated_strangle / tt-concentration-cap → BLOCK (exceeds 25% cap)",
            fixture="over_concentrated_strangle.json",
            hook="tt-concentration-cap",
            expected_exit=2,
            setup=plan_and_cap_low_spy,
            teardown=plan_and_cap_cleanup,
            note="netliq=$10k cap=$2500; existing SPY=$2300; order adds $550 → projected $2850 > cap. Verifies OTOCO opening legs are captured via trigger-order fix.",
        ),
        Test(
            name="over_concentrated_strangle / tt-require-bracket → ALLOW (valid OTOCO 50%/2x)",
            fixture="over_concentrated_strangle.json",
            hook="tt-require-bracket",
            expected_exit=0,
            setup=plan_on,
            teardown=plan_off,
            note="Bracket hook is independent of concentration; valid OTOCO bracket should pass.",
        ),

        # ------------------------------------------------------------------
        # Fail-closed: concentration cap with missing sidecar files
        # ------------------------------------------------------------------
        Test(
            name="bracketed_strangle / tt-concentration-cap (missing netliq) → BLOCK",
            fixture="bracketed_strangle.json",
            hook="tt-concentration-cap",
            expected_exit=2,
            setup=lambda: (remove_netliq(), remove_positions()),
            teardown=cap_files_cleanup,
            note="Hook must fail closed when /tmp/tt_netliq.json is absent.",
        ),
        Test(
            name="bracketed_strangle / tt-concentration-cap (missing positions) → BLOCK",
            fixture="bracketed_strangle.json",
            hook="tt-concentration-cap",
            expected_exit=2,
            setup=lambda: (write_netliq(100_000), remove_positions()),
            teardown=cap_files_cleanup,
            note="Hook must fail closed when /tmp/tt_positions.json is absent.",
        ),

        # ------------------------------------------------------------------
        # tt-ff-exit-monitor — PostToolUse hook on get_market_metrics(detail="full")
        # Fixture: ff_exit_monitor_full_response.json
        #   AAPL term structure: May16 IV=28%, Jun20 IV=32% (contango → FF < 0 → WARN)
        #   SPY  term structure: May16 IV=22%, Jun20 IV=19% (backwardation → FF > 0 → silent)
        # ------------------------------------------------------------------
        Test(
            name="ff_exit_monitor / AAPL calendar FF < 0 → WARN in stdout",
            fixture="ff_exit_monitor_full_response.json",
            hook="tt-ff-exit-monitor",
            expected_exit=0,
            setup=lambda: write_positions([
                {
                    "symbol": "AAPL 260516C00150000",
                    "instrument-type": "Equity Option",
                    "quantity": 1,
                    "quantity-direction": "Short",
                    "underlying-symbol": "AAPL",
                },
                {
                    "symbol": "AAPL 260620C00150000",
                    "instrument-type": "Equity Option",
                    "quantity": 1,
                    "quantity-direction": "Long",
                    "underlying-symbol": "AAPL",
                },
            ]),
            teardown=remove_positions,
            stdout_contains="Forward Factor edge is gone on AAPL",
            note=(
                "AAPL May16/Jun20 calendar: May16 IV=28% < Jun20 IV=32% (contango). "
                "Forward vol between the two expirations exceeds front IV → FF < 0 → warning emitted."
            ),
        ),
        Test(
            name="ff_exit_monitor / SPY calendar FF > 0 → silent",
            fixture="ff_exit_monitor_full_response.json",
            hook="tt-ff-exit-monitor",
            expected_exit=0,
            setup=lambda: write_positions([
                {
                    "symbol": "SPY 260516C00580000",
                    "instrument-type": "Equity Option",
                    "quantity": 1,
                    "quantity-direction": "Short",
                    "underlying-symbol": "SPY",
                },
                {
                    "symbol": "SPY 260620C00580000",
                    "instrument-type": "Equity Option",
                    "quantity": 1,
                    "quantity-direction": "Long",
                    "underlying-symbol": "SPY",
                },
            ]),
            teardown=remove_positions,
            stdout_absent="Forward Factor edge is gone",
            note=(
                "SPY May16/Jun20 calendar: May16 IV=22% > Jun20 IV=19% (backwardation). "
                "FF is positive — no warning should be emitted."
            ),
        ),
        Test(
            name="ff_exit_monitor / no calendar positions → silent",
            fixture="ff_exit_monitor_full_response.json",
            hook="tt-ff-exit-monitor",
            expected_exit=0,
            setup=lambda: write_positions([
                {
                    "symbol": "AAPL",
                    "instrument-type": "Equity",
                    "quantity": 100,
                    "quantity-direction": "Long",
                    "underlying-symbol": "AAPL",
                },
            ]),
            teardown=remove_positions,
            stdout_absent="Forward Factor edge is gone",
            note="No option calendar positions in the positions file → hook exits silently.",
        ),
        Test(
            name="ff_exit_monitor / positions file missing → silent",
            fixture="ff_exit_monitor_full_response.json",
            hook="tt-ff-exit-monitor",
            expected_exit=0,
            setup=remove_positions,
            teardown=remove_positions,
            stdout_absent="Forward Factor edge is gone",
            note="No /tmp/tt_positions.json file → hook exits silently without error.",
        ),
    ]


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def run_all(as_json=False):
    tests = make_tests()
    results = []
    passed = 0
    failed = 0

    for t in tests:
        result = t.run()
        results.append(result)
        if result["passed"]:
            passed += 1
        else:
            failed += 1

    if as_json:
        print(json.dumps({"passed": passed, "failed": failed, "results": results}, indent=2))
        return failed == 0

    width = 72
    print("=" * width)
    print("  TastyTrade Hook Integration Tests")
    print("=" * width)

    for r in results:
        status = "PASS" if r["passed"] else "FAIL"
        print(f"\n[{status}] {r['name']}")
        if r["note"]:
            print(f"       note   : {r['note']}")
        if not r["passed"]:
            print(f"       fixture: {r['fixture']}")
            print(f"       hook   : {r['hook']}")
            print(f"       expected exit {r['expected']}, got {r['got']}")
            if r["stdout"]:
                for line in r["stdout"].splitlines():
                    print(f"       stdout : {line}")
            if r["stderr"]:
                for line in r["stderr"].splitlines():
                    print(f"       stderr : {line}")

    print("\n" + "=" * width)
    print(f"  Results: {passed} passed, {failed} failed  (total {passed + failed})")
    print("=" * width)

    return failed == 0


if __name__ == "__main__":
    use_json = "--json" in sys.argv
    ok = run_all(as_json=use_json)
    sys.exit(0 if ok else 1)
