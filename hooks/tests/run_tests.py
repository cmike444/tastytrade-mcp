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
from datetime import date as _date, timedelta
from pathlib import Path

HOOKS_DIR = Path(__file__).parent.parent
FIXTURES_DIR = Path(__file__).parent / "fixtures"

HOOKS = {
    "tt-require-bracket":            str(HOOKS_DIR / "tt-require-bracket.py"),
    "tt-concentration-cap":          str(HOOKS_DIR / "tt-concentration-cap.py"),
    "tt-require-plan":               str(HOOKS_DIR / "tt-require-plan.py"),
    "tt-ff-exit-monitor":            str(HOOKS_DIR / "tt-ff-exit-monitor.py"),
    "tt-calendar-expiry-alert":      str(HOOKS_DIR / "tt-calendar-expiry-alert.py"),
    "tt-require-dte":                str(HOOKS_DIR / "tt-require-dte.py"),
    "tt-fetch-earnings-straddle":    str(HOOKS_DIR / "tt-fetch-earnings-straddle.py"),
    "tt-ff-stage2-exearn":           str(HOOKS_DIR / "tt-ff-stage2-exearn.py"),
    "tt-populate-earnings-dates":    str(HOOKS_DIR / "tt-populate-earnings-dates.py"),
}

PLAN_FILE     = "/tmp/tt_pending_plan.json"
NETLIQ_FILE   = "/tmp/tt_netliq.json"
POSITIONS_FILE = "/tmp/tt_positions.json"
MOCK_STRADDLE_FETCH = str(FIXTURES_DIR / "mock_straddle_fetch.py")


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

EARNINGS_MOVES_FILE = "/tmp/tt_earnings_moves.json"
EARNINGS_DATES_FILE = "/tmp/tt_earnings_dates.json"

def write_earnings_moves(moves):
    Path(EARNINGS_MOVES_FILE).write_text(json.dumps(moves))

def remove_earnings_moves():
    Path(EARNINGS_MOVES_FILE).unlink(missing_ok=True)

def write_earnings_dates(dates):
    Path(EARNINGS_DATES_FILE).write_text(json.dumps(dates))

def remove_earnings_dates():
    Path(EARNINGS_DATES_FILE).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Stage 2 dynamic payload helpers (dates relative to today so tests never age out)
# ---------------------------------------------------------------------------

def _stage2_aapl_items(front_date, back_date):
    """
    Build a list of get_options_greeks response items for a synthetic AAPL
    Stage 2 scan: three call strikes (195/200/205) across two expiries.

    Front IVs are elevated vs. back to simulate earnings-inflated term structure:
      195C: front=40%, back=25%
      200C: front=35%, back=24%
      205C: front=38%, back=24%

    Raw FF_strike: 195=60%, 200=45.8%, 205=58.3%
    With implied_move=5% and DTE_front around 18:
      ex-earn front IVs ≈ 195→33%, 200→27%, 205→31%
      ex-earn FF_strike ≈ 195=+32%, 200=+12%, 205=+28% → best=195
    """
    def sym(expiry, strike):
        return ".AAPL{}C{}".format(expiry.strftime("%y%m%d"), strike)

    return [
        {"symbol": sym(front_date, "00195000"), "underlying-symbol": "AAPL",
         "option-type": "C", "strike-price": "195.0", "implied-volatility": 0.40},
        {"symbol": sym(back_date,  "00195000"), "underlying-symbol": "AAPL",
         "option-type": "C", "strike-price": "195.0", "implied-volatility": 0.25},
        {"symbol": sym(front_date, "00200000"), "underlying-symbol": "AAPL",
         "option-type": "C", "strike-price": "200.0", "implied-volatility": 0.35},
        {"symbol": sym(back_date,  "00200000"), "underlying-symbol": "AAPL",
         "option-type": "C", "strike-price": "200.0", "implied-volatility": 0.24},
        {"symbol": sym(front_date, "00205000"), "underlying-symbol": "AAPL",
         "option-type": "C", "strike-price": "205.0", "implied-volatility": 0.38},
        {"symbol": sym(back_date,  "00205000"), "underlying-symbol": "AAPL",
         "option-type": "C", "strike-price": "205.0", "implied-volatility": 0.24},
    ]


def _stage2_payload(items):
    """Wrap a list of option items in a get_options_greeks hook payload."""
    return {
        "tool_name": "get_options_greeks",
        "tool_input": {},
        "tool_response": [
            {
                "type": "text",
                "text": json.dumps({"data": {"items": items}}),
            }
        ],
    }


# ---------------------------------------------------------------------------
# Calendar-expiry-alert helpers  (dynamic dates so the hook's date.today()
# check always works regardless of when the test suite is run)
# ---------------------------------------------------------------------------

def _occ_date(d):
    """Format a date as the 6-char YYMMDD used inside OCC symbols."""
    return d.strftime("%y%m%d")


def _calendar_positions(front_date, back_date,
                        underlying="AAPL", opt_type="C", strike="00200000"):
    """Return a two-leg positions list representing a calendar spread."""
    return [
        {
            "symbol": "{} {}{}{}".format(underlying, _occ_date(front_date), opt_type, strike),
            "instrument-type": "Equity Option",
            "quantity": 1,
            "quantity-direction": "Short",
            "underlying-symbol": underlying,
        },
        {
            "symbol": "{} {}{}{}".format(underlying, _occ_date(back_date), opt_type, strike),
            "instrument-type": "Equity Option",
            "quantity": 1,
            "quantity-direction": "Long",
            "underlying-symbol": underlying,
        },
    ]


def _futures_calendar_positions(front_date, back_date,
                                front_underlying="./ESM6", back_underlying=None,
                                option_root_front="EW1M6", option_root_back=None,
                                opt_type="C", strike="4800"):
    """
    Return a two-leg positions list for a futures-option calendar spread.

    Symbols follow the TastyTrade futures-option format:
        ./UNDERLYING OPTION_ROOT YYMMDDCP STRIKE

    When back_underlying differs from front_underlying (cross-contract calendar),
    parse_occ_symbol must strip the contract-month suffix to match the two legs.
    """
    if back_underlying is None:
        back_underlying = front_underlying
    if option_root_back is None:
        option_root_back = option_root_front
    return [
        {
            "symbol": "{} {} {}{}{}".format(
                front_underlying, option_root_front,
                _occ_date(front_date), opt_type, strike,
            ),
            "instrument-type": "Future Option",
            "quantity": 1,
            "quantity-direction": "Short",
            "underlying-symbol": front_underlying,
        },
        {
            "symbol": "{} {} {}{}{}".format(
                back_underlying, option_root_back,
                _occ_date(back_date), opt_type, strike,
            ),
            "instrument-type": "Future Option",
            "quantity": 1,
            "quantity-direction": "Long",
            "underlying-symbol": back_underlying,
        },
    ]


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


def run_hook_payload(hook_name, payload, *, env=None):
    """Run a hook with the given payload dict on stdin. Returns (exit_code, stdout, stderr)."""
    hook_path = HOOKS[hook_name]
    result = subprocess.run(
        [sys.executable, hook_path],
        input=json.dumps(payload),
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
        env=None,
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
        self.env = env or {}

    def run(self):
        self.setup()
        try:
            code, stdout, stderr = run_hook(self.hook, self.fixture, env=self.env)
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


class TestSidecar(Test):
    """
    Like Test but also verifies the content of /tmp/tt_earnings_moves.json
    after the hook runs.  Pass `sidecar_has` (dict of sym→approx value pairs)
    and/or `sidecar_absent` (list of symbol keys) to assert on sidecar state.

    Values in `sidecar_has` are compared within a relative tolerance of 1%.
    """

    def __init__(self, *args, sidecar_has=None, sidecar_absent=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.sidecar_has = sidecar_has or {}
        self.sidecar_absent = sidecar_absent or []
        self._sidecar_path = Path(EARNINGS_MOVES_FILE)

    def run(self):
        self.setup()
        sidecar_data = {}
        try:
            code, stdout, stderr = run_hook(self.hook, self.fixture, env=self.env)
            try:
                sidecar_data = (
                    json.loads(self._sidecar_path.read_text())
                    if self._sidecar_path.exists()
                    else {}
                )
            except (json.JSONDecodeError, OSError):
                sidecar_data = {}
        finally:
            self.teardown()

        passed = code == self.expected_exit
        if passed and self.stdout_contains is not None:
            passed = self.stdout_contains in stdout
        if passed and self.stdout_absent is not None:
            passed = self.stdout_absent not in stdout

        if passed:
            for sym, expected_val in self.sidecar_has.items():
                actual = sidecar_data.get(sym)
                if actual is None:
                    passed = False
                    self.note = (self.note or "") + f" | FAIL: sidecar missing key '{sym}'"
                    break
                try:
                    rel_err = abs(float(actual) - float(expected_val)) / float(expected_val)
                    if rel_err > 0.01:
                        passed = False
                        self.note = (self.note or "") + (
                            f" | FAIL: sidecar['{sym}']={actual:.6f} expected~{expected_val:.6f}"
                        )
                        break
                except (TypeError, ValueError):
                    passed = False
                    break

        if passed:
            for sym in self.sidecar_absent:
                if sym in sidecar_data:
                    passed = False
                    self.note = (self.note or "") + (
                        f" | FAIL: sidecar unexpectedly contains key '{sym}'"
                    )
                    break

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


class TestSidecarDates(Test):
    """
    Like Test but verifies the content of /tmp/tt_earnings_dates.json after
    the hook runs.  Pass `sidecar_has` (dict of sym→ISO-date-string pairs)
    and/or `sidecar_absent` (list of symbol keys) to assert on sidecar state.

    Date values in `sidecar_has` are compared as ISO strings (exact match).
    """

    def __init__(self, *args, sidecar_has=None, sidecar_absent=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.sidecar_has = sidecar_has or {}
        self.sidecar_absent = sidecar_absent or []
        self._sidecar_path = Path(EARNINGS_DATES_FILE)

    def run(self):
        self.setup()
        sidecar_data = {}
        try:
            code, stdout, stderr = run_hook(self.hook, self.fixture, env=self.env)
            try:
                sidecar_data = (
                    json.loads(self._sidecar_path.read_text())
                    if self._sidecar_path.exists()
                    else {}
                )
            except (json.JSONDecodeError, OSError):
                sidecar_data = {}
        finally:
            self.teardown()

        passed = code == self.expected_exit
        if passed and self.stdout_contains is not None:
            passed = self.stdout_contains in stdout
        if passed and self.stdout_absent is not None:
            passed = self.stdout_absent not in stdout

        if passed:
            for sym, expected_val in self.sidecar_has.items():
                actual = sidecar_data.get(sym)
                if actual is None:
                    passed = False
                    self.note = (self.note or "") + f" | FAIL: sidecar missing key '{sym}'"
                    break
                if str(actual) != str(expected_val):
                    passed = False
                    self.note = (self.note or "") + (
                        f" | FAIL: sidecar['{sym}']={actual!r} expected {expected_val!r}"
                    )
                    break

        if passed:
            for sym in self.sidecar_absent:
                if sym in sidecar_data:
                    passed = False
                    self.note = (self.note or "") + (
                        f" | FAIL: sidecar unexpectedly contains key '{sym}'"
                    )
                    break

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


class TestDTESidecarDates:
    """
    Like TestSidecarDates but uses a dynamically-generated payload dict
    instead of a static fixture file.  Use when the hook inspects date.today()
    and both the payload and sidecar assertions depend on relative dates.

    Pass `sidecar_has` (dict of sym→ISO-date-string) and/or `sidecar_absent`
    (list of symbol keys) to assert on the state of tt_earnings_dates.json
    after the hook exits.
    """

    def __init__(
        self,
        name,
        payload_fn,
        hook,
        expected_exit,
        env=None,
        setup=None,
        teardown=None,
        note="",
        stdout_contains=None,
        stdout_absent=None,
        sidecar_has=None,
        sidecar_absent=None,
    ):
        self.name = name
        self.payload_fn = payload_fn
        self.hook = hook
        self.expected_exit = expected_exit
        self.env = env or {}
        self.setup = setup or (lambda: None)
        self.teardown = teardown or (lambda: None)
        self.note = note
        self.stdout_contains = stdout_contains
        self.stdout_absent = stdout_absent
        self.sidecar_has = sidecar_has or {}
        self.sidecar_absent = sidecar_absent or []
        self.fixture = "(dynamic)"
        self._sidecar_path = Path(EARNINGS_DATES_FILE)

    def run(self):
        self.setup()
        sidecar_data = {}
        try:
            payload = self.payload_fn()
            code, stdout, stderr = run_hook_payload(self.hook, payload, env=self.env)
            try:
                sidecar_data = (
                    json.loads(self._sidecar_path.read_text())
                    if self._sidecar_path.exists()
                    else {}
                )
            except (json.JSONDecodeError, OSError):
                sidecar_data = {}
        finally:
            self.teardown()

        passed = code == self.expected_exit
        if passed and self.stdout_contains is not None:
            passed = self.stdout_contains in stdout
        if passed and self.stdout_absent is not None:
            passed = self.stdout_absent not in stdout

        if passed:
            for sym, expected_val in self.sidecar_has.items():
                actual = sidecar_data.get(sym)
                if actual is None:
                    passed = False
                    self.note = (self.note or "") + f" | FAIL: sidecar missing key '{sym}'"
                    break
                if str(actual) != str(expected_val):
                    passed = False
                    self.note = (self.note or "") + (
                        f" | FAIL: sidecar['{sym}']={actual!r} expected {expected_val!r}"
                    )
                    break

        if passed:
            for sym in self.sidecar_absent:
                if sym in sidecar_data:
                    passed = False
                    self.note = (self.note or "") + (
                        f" | FAIL: sidecar unexpectedly contains key '{sym}'"
                    )
                    break

        return {
            "name": self.name,
            "fixture": self.fixture,
            "hook": self.hook,
            "expected": self.expected_exit,
            "got": code,
            "passed": passed,
            "stdout": stdout,
            "stderr": stderr,
            "note": self.note,
        }


class TestDTE:
    """
    Like Test but uses a dynamically-generated payload dict instead of a
    static fixture file.  Use when the hook inspects date.today() and the
    OCC symbol dates must be computed relative to the current date.
    """

    def __init__(
        self,
        name,
        payload_fn,
        hook,
        expected_exit,
        env=None,
        setup=None,
        teardown=None,
        note="",
        stdout_contains=None,
        stdout_absent=None,
    ):
        self.name = name
        self.payload_fn = payload_fn
        self.hook = hook
        self.expected_exit = expected_exit
        self.env = env or {}
        self.setup = setup or (lambda: None)
        self.teardown = teardown or (lambda: None)
        self.note = note
        self.stdout_contains = stdout_contains
        self.stdout_absent = stdout_absent
        self.fixture = "(dynamic)"

    def run(self):
        self.setup()
        try:
            payload = self.payload_fn()
            code, stdout, stderr = run_hook_payload(self.hook, payload, env=self.env)
        finally:
            self.teardown()
        passed = code == self.expected_exit
        if passed and self.stdout_contains is not None:
            passed = self.stdout_contains in stdout
        if passed and self.stdout_absent is not None:
            passed = self.stdout_absent not in stdout
        return {
            "name": self.name,
            "fixture": self.fixture,
            "hook": self.hook,
            "expected": self.expected_exit,
            "got": code,
            "passed": passed,
            "stdout": stdout,
            "stderr": stderr,
            "note": self.note,
        }


# ---------------------------------------------------------------------------
# DTE test payload helpers
# ---------------------------------------------------------------------------

def _occ_symbol(underlying, expiry_date, opt_type="C", strike="00200000"):
    """Build an OCC option symbol with the given expiry date embedded."""
    return "{} {}{}{}".format(underlying, expiry_date.strftime("%y%m%d"), opt_type, strike)


def _dte_order(symbol, instrument_type="Equity Option", action="Sell to Open",
               tool_name="create_order", strategy=None):
    """Return a minimal hook-input envelope for a single-leg option order.

    Pass ``strategy`` to embed a "strategy" field in the order payload so the
    hook can apply per-strategy DTE thresholds (via TT_DTE_THRESHOLDS).
    """
    order = {
        "time-in-force": "Day",
        "order-type": "Limit",
        "price": 3.50,
        "legs": [
            {
                "instrument-type": instrument_type,
                "symbol": symbol,
                "action": action,
                "quantity": 1,
            }
        ],
    }
    if strategy is not None:
        order["strategy"] = strategy
    return {
        "tool_name": tool_name,
        "tool_input": order,
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

    def cap_files_low_netliq_aapl_near_cap():
        # netliq=$10,000 → cap=$2,500; existing AAPL exposure=$2,300
        # naked_short order adds $3.50*1*100=$350 → projected=$2,650 > cap
        write_netliq(10_000)
        write_positions([
            {
                "underlying-symbol": "AAPL",
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
            name="naked_short / tt-concentration-cap (within limits) → ALLOW",
            fixture="naked_short.json",
            hook="tt-concentration-cap",
            expected_exit=0,
            setup=cap_files_ok,
            teardown=cap_files_cleanup,
            note="create_order is now watched; $3.50*1*100=$350 notional on netliq=$100k is well within the 25% cap.",
        ),
        Test(
            name="naked_short / tt-concentration-cap (exceeds 25% cap) → BLOCK",
            fixture="naked_short.json",
            hook="tt-concentration-cap",
            expected_exit=2,
            setup=cap_files_low_netliq_aapl_near_cap,
            teardown=cap_files_cleanup,
            note="Single-leg create_order: netliq=$10k cap=$2500; existing AAPL=$2300; order adds $3.50*1*100=$350 → projected $2650 > cap. Verifies create_order is now covered by the concentration cap.",
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
        # ratio_spread — 2:1 put ratio spread (1 BTO + 2 STO → 1 naked leg)
        # ------------------------------------------------------------------
        Test(
            name="ratio_spread_naked / tt-require-bracket → BLOCK (no OTOCO, ratio spread)",
            fixture="ratio_spread_naked.json",
            hook="tt-require-bracket",
            expected_exit=2,
            setup=plan_on,
            teardown=plan_off,
            note="2 STO vs 1 BTO = 1 naked leg; no bracket at all → must be blocked with ratio-spread detail.",
            stdout_contains="ratio spread detected",
        ),
        Test(
            name="ratio_spread / tt-require-bracket → ALLOW (OTOCO bracket covers net credit)",
            fixture="ratio_spread.json",
            hook="tt-require-bracket",
            expected_exit=0,
            setup=plan_on,
            teardown=plan_off,
            note="2:1 put ratio spread wrapped in OTOCO; profit=$1.00 (50% of $2.00), stop=$4.00 (2× $2.00) — within allowed range.",
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
        # futures_option_otoco_50x — /ES futures-option OTOCO with explicit
        # multiplier=50 field; verifies 50x is used instead of hard-coded 100x
        # ------------------------------------------------------------------
        Test(
            name="futures_option_otoco_50x / tt-concentration-cap (explicit multiplier=50) → ALLOW",
            fixture="futures_option_otoco_50x.json",
            hook="tt-concentration-cap",
            expected_exit=0,
            setup=lambda: (write_netliq(10_000), write_positions([])),
            teardown=cap_files_cleanup,
            note=(
                "netliq=$10k cap=$2500; price=$25 qty=2 multiplier=50 → notional=$25*2*50=$2500 "
                "which equals but does not exceed the cap (ALLOW). With the wrong 100x multiplier "
                "notional would be $5000 → BLOCK, so this test fails if multiplier field is ignored."
            ),
        ),

        # ------------------------------------------------------------------
        # futures_option_otoco_5x — /MES futures-option OTOCO with explicit
        # multiplier=5 field; verifies 5x is used instead of hard-coded 100x
        # ------------------------------------------------------------------
        Test(
            name="futures_option_otoco_5x / tt-concentration-cap (explicit multiplier=5) → ALLOW",
            fixture="futures_option_otoco_5x.json",
            hook="tt-concentration-cap",
            expected_exit=0,
            setup=lambda: (write_netliq(10_000), write_positions([])),
            teardown=cap_files_cleanup,
            note=(
                "netliq=$10k cap=$2500; price=$25 qty=2 multiplier=5 → notional=$25*2*5=$250 "
                "which is well within the cap (ALLOW). With the wrong 100x multiplier "
                "notional would be $5000 → BLOCK, so this test fails if multiplier field is ignored."
            ),
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
        # otoco_no_bracket — create_complex_order OTOCO with no child orders
        # Regression guard: verifies opening legs are read from trigger-order.legs
        # (not a flat top-level legs key) and that missing bracket orders triggers BLOCK
        # ------------------------------------------------------------------
        Test(
            name="otoco_no_bracket / tt-require-bracket → BLOCK (OTOCO missing bracket children)",
            fixture="otoco_no_bracket.json",
            hook="tt-require-bracket",
            expected_exit=2,
            setup=plan_on,
            teardown=plan_off,
            note=(
                "create_complex_order OTOCO with STO legs in trigger-order.legs but empty orders[]. "
                "Hook must read opening legs from trigger-order.legs (not flat top-level legs) and "
                "block because < 2 bracket children are present. Regression guard for nested schema parsing."
            ),
            stdout_contains="BLOCKED",
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

        # ------------------------------------------------------------------
        # tt-ff-exit-monitor — earnings-awareness (ex-earn IV advisory)
        # Fixture earnings dates: AAPL 2026-05-10 (front window), SPY 2026-05-25 (back window)
        # ------------------------------------------------------------------
        Test(
            name="ff_exit_monitor / AAPL FF<0 + earnings in front window → WARN + FRONT advisory",
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
            stdout_contains="FRONT expiry window",
            note=(
                "AAPL FF < 0 (contango) and earnings 2026-05-10 fall within front window "
                "(before May16). Hook must emit the exit warning AND note that front IV "
                "may include earnings premium."
            ),
        ),
        Test(
            name="ff_exit_monitor / SPY FF>0 + earnings in back window → earnings-IV advisory only",
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
            stdout_contains="back expiry window",
            note=(
                "SPY FF > 0 (backwardation, no exit warning) and earnings 2026-05-25 fall "
                "within back window (after May16, before Jun20). Hook must emit an "
                "earnings-IV advisory noting that raw IVs include earnings premium."
            ),
        ),

        # ------------------------------------------------------------------
        # tt-ff-exit-monitor — ex-earn FF computation (task #84)
        # Fixture earnings dates: AAPL 2026-05-10 (front window), SPY 2026-05-25 (back window)
        # Earnings moves sidecar: {"AAPL": 0.04, "SPY": 0.02}
        # ------------------------------------------------------------------
        Test(
            name="ff_exit_monitor / AAPL FF<0 + earnings in front window + implied_move → ex-earn FF reported",
            fixture="ff_exit_monitor_full_response.json",
            hook="tt-ff-exit-monitor",
            expected_exit=0,
            setup=lambda: [
                write_positions([
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
                write_earnings_moves({"AAPL": 0.04}),
            ],
            teardown=lambda: [remove_positions(), remove_earnings_moves()],
            stdout_contains="Ex-earn FF",
            note=(
                "AAPL FF < 0 and earnings May10 in front window. Sidecar provides implied "
                "move 4%. Hook must strip earnings premium from front IV and report "
                "ex-earn FF in the warning output."
            ),
        ),
        Test(
            name="ff_exit_monitor / AAPL FF<0 + earnings in front window + implied_move → closing remains appropriate",
            fixture="ff_exit_monitor_full_response.json",
            hook="tt-ff-exit-monitor",
            expected_exit=0,
            setup=lambda: [
                write_positions([
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
                write_earnings_moves({"AAPL": 0.04}),
            ],
            teardown=lambda: [remove_positions(), remove_earnings_moves()],
            stdout_contains="closing remains appropriate",
            note=(
                "When FF<0 and earnings are in the FRONT window, stripping the earnings "
                "premium lowers front IV further, so ex-earn FF is even more negative. "
                "The hook must confirm that closing remains appropriate."
            ),
        ),
        Test(
            name="ff_exit_monitor / SPY FF>0 + earnings in back window + implied_move → ex-earn FF reported in advisory",
            fixture="ff_exit_monitor_full_response.json",
            hook="tt-ff-exit-monitor",
            expected_exit=0,
            setup=lambda: [
                write_positions([
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
                write_earnings_moves({"SPY": 0.02}),
            ],
            teardown=lambda: [remove_positions(), remove_earnings_moves()],
            stdout_contains="ex-earn FF",
            note=(
                "SPY FF > 0 and earnings May25 in back window. Sidecar provides implied "
                "move 2%. Hook must strip earnings premium from back IV and report "
                "the ex-earn FF in the advisory output."
            ),
        ),
        Test(
            name="ff_exit_monitor / SPY FF>0 + earnings in back window + implied_move → edge confirmed",
            fixture="ff_exit_monitor_full_response.json",
            hook="tt-ff-exit-monitor",
            expected_exit=0,
            setup=lambda: [
                write_positions([
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
                write_earnings_moves({"SPY": 0.02}),
            ],
            teardown=lambda: [remove_positions(), remove_earnings_moves()],
            stdout_contains="Ex-earn FF",
            note=(
                "SPY back IV is inflated by earnings premium. After stripping, back IV "
                "drops, raising ex-earn FF above raw FF — edge is confirmed. Hook must "
                "report 'Ex-earn FF' in the advisory."
            ),
        ),
        Test(
            name="ff_exit_monitor / AAPL FF<0 + earnings in front window + implied_move too large → no ex-earn FF numeric",
            fixture="ff_exit_monitor_full_response.json",
            hook="tt-ff-exit-monitor",
            expected_exit=0,
            setup=lambda: [
                write_positions([
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
                write_earnings_moves({"AAPL": 0.10}),
            ],
            teardown=lambda: [remove_positions(), remove_earnings_moves()],
            stdout_contains="FRONT expiry window",
            stdout_absent="Ex-earn FF =",
            note=(
                "Implied move of 10% exceeds front IV over 20 DTE — ex-earn variance is "
                "non-positive, so compute_exearn_iv returns None. Hook must fall back to "
                "advisory-only text without emitting a numeric 'Ex-earn FF = ...' value."
            ),
        ),
        Test(
            name="ff_exit_monitor / SPY FF>0 + earnings in back window + implied_move too large → no ex-earn FF numeric",
            fixture="ff_exit_monitor_full_response.json",
            hook="tt-ff-exit-monitor",
            expected_exit=0,
            setup=lambda: [
                write_positions([
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
                write_earnings_moves({"SPY": 0.10}),
            ],
            teardown=lambda: [remove_positions(), remove_earnings_moves()],
            stdout_contains="back expiry window",
            stdout_absent="Ex-earn FF =",
            note=(
                "Implied move of 10% exceeds back IV over 55 DTE — ex-earn variance is "
                "non-positive, so compute_exearn_iv returns None. Hook must fall back to "
                "advisory-only text without emitting a numeric 'Ex-earn FF = ...' value."
            ),
        ),
        Test(
            name="ff_exit_monitor / earnings in front window + no sidecar → falls back to advisory-only text",
            fixture="ff_exit_monitor_full_response.json",
            hook="tt-ff-exit-monitor",
            expected_exit=0,
            setup=lambda: [
                write_positions([
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
                remove_earnings_moves(),
            ],
            teardown=lambda: [remove_positions(), remove_earnings_moves()],
            stdout_contains="FRONT expiry window",
            stdout_absent="implied move",
            note=(
                "When the earnings moves sidecar is absent, the hook falls back to the "
                "advisory-only message (no ex-earn FF computed — 'implied move' text only "
                "appears when the sidecar provides a value). The FRONT expiry window "
                "note must still appear."
            ),
        ),

        # Self-healing path: sidecar absent → auto-prefetch via mock → ex-earn FF computed
        Test(
            name="ff_exit_monitor / earnings in front window + no sidecar + prefetch mock → ex-earn FF reported",
            fixture="ff_exit_monitor_full_response.json",
            hook="tt-ff-exit-monitor",
            expected_exit=0,
            env={"TT_STRADDLE_HOOK": MOCK_STRADDLE_FETCH},
            setup=lambda: [
                write_positions([
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
                remove_earnings_moves(),
            ],
            teardown=lambda: [remove_positions(), remove_earnings_moves()],
            stdout_contains="Ex-earn FF",
            note=(
                "When sidecar is absent but TT_STRADDLE_HOOK points to a mock script that "
                "writes AAPL implied_move=0.04, the monitor must call it, reload the sidecar, "
                "and report ex-earn FF (stripping the earnings premium from front IV). "
                "This verifies the full self-healing prefetch → ex-earn FF path end-to-end."
            ),
        ),

        # ------------------------------------------------------------------
        # tt-ff-exit-monitor — cross-contract futures calendar (/ESM6 / /ESU6)
        # The bug: without stripping the CME suffix, ESM6 ≠ ESU6 so the two
        # legs are never grouped into a calendar pair and the monitor is silent.
        # After the fix, both legs reduce to root "ES" and the contango term
        # structure (Jun20 IV=16% < Sep19 IV=20%) yields FF < 0 → WARN.
        # ------------------------------------------------------------------
        Test(
            name="ff_exit_monitor / cross-contract /ESM6//ESU6 calendar FF < 0 → WARN in stdout",
            fixture="ff_exit_monitor_full_response.json",
            hook="tt-ff-exit-monitor",
            expected_exit=0,
            setup=lambda: write_positions(
                _futures_calendar_positions(
                    front_date=_date(2026, 6, 20),
                    back_date=_date(2026, 9, 19),
                    front_underlying="./ESM6",
                    back_underlying="./ESU6",
                    option_root_front="EW1M6",
                    option_root_back="EW1U6",
                    opt_type="C",
                    strike="4800",
                )
            ),
            teardown=remove_positions,
            stdout_contains="Forward Factor edge is gone on ES",
            note=(
                "Cross-contract /ES calendar: short ./ESM6 Jun20, long ./ESU6 Sep19. "
                "Without stripping the CME contract-month suffix (M6/U6), the two legs "
                "would never match as a calendar pair. With the fix, both reduce to root "
                "'ES', the contango term structure (Jun20 IV=16% < Sep19 IV=20%) gives "
                "FF < 0, and the exit warning must be emitted."
            ),
        ),

        # ------------------------------------------------------------------
        # tt-calendar-expiry-alert — PostToolUse on get_positions or
        # get_market_metrics(detail="full")
        # ------------------------------------------------------------------
        Test(
            name="calendar_expiry_alert / front expires today → WARN",
            fixture="calendar_expiry_alert.json",
            hook="tt-calendar-expiry-alert",
            expected_exit=0,
            setup=lambda: write_positions(
                _calendar_positions(
                    front_date=_date.today(),
                    back_date=_date.today() + timedelta(days=30),
                )
            ),
            teardown=remove_positions,
            stdout_contains="close the spread before market close",
            note="Front leg expires today (DTE=0) → warning must be printed.",
        ),
        Test(
            name="calendar_expiry_alert / front expires tomorrow → WARN",
            fixture="calendar_expiry_alert.json",
            hook="tt-calendar-expiry-alert",
            expected_exit=0,
            setup=lambda: write_positions(
                _calendar_positions(
                    front_date=_date.today() + timedelta(days=1),
                    back_date=_date.today() + timedelta(days=31),
                )
            ),
            teardown=remove_positions,
            stdout_contains="close the spread before market close",
            note="Front leg expires tomorrow (DTE=1) → warning must be printed.",
        ),
        Test(
            name="calendar_expiry_alert / front 5 DTE → silent",
            fixture="calendar_expiry_alert.json",
            hook="tt-calendar-expiry-alert",
            expected_exit=0,
            setup=lambda: write_positions(
                _calendar_positions(
                    front_date=_date.today() + timedelta(days=5),
                    back_date=_date.today() + timedelta(days=35),
                )
            ),
            teardown=remove_positions,
            stdout_absent="close the spread before market close",
            note="Front leg expires in 5 days (DTE=5) → no warning; only ≤1 DTE triggers alert.",
        ),
        Test(
            name="calendar_expiry_alert / no calendar positions → silent",
            fixture="calendar_expiry_alert.json",
            hook="tt-calendar-expiry-alert",
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
            stdout_absent="close the spread before market close",
            note="Positions contain only equity, no calendar spread → hook exits silently.",
        ),
        Test(
            name="calendar_expiry_alert / positions file missing → silent",
            fixture="calendar_expiry_alert.json",
            hook="tt-calendar-expiry-alert",
            expected_exit=0,
            setup=remove_positions,
            teardown=remove_positions,
            stdout_absent="close the spread before market close",
            note="No /tmp/tt_positions.json → hook exits silently without error.",
        ),
        Test(
            name="calendar_expiry_alert / get_market_metrics detail=full trigger → WARN",
            fixture="ff_exit_monitor_full_response.json",
            hook="tt-calendar-expiry-alert",
            expected_exit=0,
            setup=lambda: write_positions(
                _calendar_positions(
                    front_date=_date.today(),
                    back_date=_date.today() + timedelta(days=30),
                    underlying="AAPL",
                )
            ),
            teardown=remove_positions,
            stdout_contains="close the spread before market close",
            note=(
                "Hook also fires on get_market_metrics(detail='full'); with front leg "
                "expiring today it must emit the warning regardless of the tool used."
            ),
        ),

        # ------------------------------------------------------------------
        # tt-calendar-expiry-alert — futures-option calendar spreads
        # Same-contract: both legs on ./ESM6 (no root-stripping needed).
        # Cross-contract: short on ./ESM6 / long on ./ESU6 — root must be
        # stripped (ESM6 → ES, ESU6 → ES) for the pair to be detected.
        # ------------------------------------------------------------------
        Test(
            name="calendar_expiry_alert / futures-option same-contract front expires today → WARN",
            fixture="futures_option_calendar.json",
            hook="tt-calendar-expiry-alert",
            expected_exit=0,
            setup=lambda: write_positions(
                _futures_calendar_positions(
                    front_date=_date.today(),
                    back_date=_date.today() + timedelta(days=30),
                    front_underlying="./ESM6",
                    back_underlying="./ESM6",
                    option_root_front="EW1M6",
                    option_root_back="EW2M6",
                )
            ),
            teardown=remove_positions,
            stdout_contains="close the spread before market close",
            note=(
                "Both /ES legs on same contract (./ESM6); front expires today. "
                "instrument-type='Future Option' must be recognised; warning must fire."
            ),
        ),
        Test(
            name="calendar_expiry_alert / futures-option cross-contract front expires today → WARN",
            fixture="futures_option_calendar.json",
            hook="tt-calendar-expiry-alert",
            expected_exit=0,
            setup=lambda: write_positions(
                _futures_calendar_positions(
                    front_date=_date.today(),
                    back_date=_date.today() + timedelta(days=90),
                    front_underlying="./ESM6",
                    back_underlying="./ESU6",
                    option_root_front="EW1M6",
                    option_root_back="EW3U6",
                )
            ),
            teardown=remove_positions,
            stdout_contains="close the spread before market close",
            note=(
                "Cross-contract /ES calendar: short ./ESM6, long ./ESU6. "
                "parse_occ_symbol must strip the contract-month suffix (ESM6→ES, ESU6→ES) "
                "to group the legs as a calendar pair. Front expires today → WARN."
            ),
        ),
        Test(
            name="calendar_expiry_alert / futures-option cross-contract front 5 DTE → silent",
            fixture="futures_option_calendar.json",
            hook="tt-calendar-expiry-alert",
            expected_exit=0,
            setup=lambda: write_positions(
                _futures_calendar_positions(
                    front_date=_date.today() + timedelta(days=5),
                    back_date=_date.today() + timedelta(days=95),
                    front_underlying="./ESM6",
                    back_underlying="./ESU6",
                    option_root_front="EW1M6",
                    option_root_back="EW3U6",
                )
            ),
            teardown=remove_positions,
            stdout_absent="close the spread before market close",
            note=(
                "Cross-contract /ES calendar with front leg 5 DTE (>1) → no alert; "
                "only ≤1 DTE triggers the warning."
            ),
        ),

        # ------------------------------------------------------------------
        # tt-require-dte — DTE warning hook
        # ------------------------------------------------------------------

        # Default threshold (21 DTE): STO option exactly at threshold → WARN
        TestDTE(
            name="tt-require-dte / STO at 21 DTE (default threshold) → WARN (exit 1)",
            payload_fn=lambda: _dte_order(
                _occ_symbol("AAPL", _date.today() + timedelta(days=21)),
                instrument_type="Equity Option",
                action="Sell to Open",
            ),
            hook="tt-require-dte",
            expected_exit=1,
            stdout_contains="WARNING",
            note=(
                "STO equity option with exactly 21 DTE equals the default threshold; "
                "hook must print a WARNING and exit 1."
            ),
        ),

        # Default threshold (21 DTE): STO option one day above threshold → ALLOW
        TestDTE(
            name="tt-require-dte / STO at 22 DTE (default threshold) → ALLOW (exit 0)",
            payload_fn=lambda: _dte_order(
                _occ_symbol("AAPL", _date.today() + timedelta(days=22)),
                instrument_type="Equity Option",
                action="Sell to Open",
            ),
            hook="tt-require-dte",
            expected_exit=0,
            stdout_absent="WARNING",
            note=(
                "STO equity option with 22 DTE is one day above the default 21-DTE threshold; "
                "hook must exit silently."
            ),
        ),

        # Default threshold (21 DTE): STO option below threshold → WARN
        TestDTE(
            name="tt-require-dte / STO at 20 DTE (default threshold) → WARN (exit 1)",
            payload_fn=lambda: _dte_order(
                _occ_symbol("AAPL", _date.today() + timedelta(days=20)),
                instrument_type="Equity Option",
                action="Sell to Open",
            ),
            hook="tt-require-dte",
            expected_exit=1,
            stdout_contains="WARNING",
            note=(
                "STO equity option with 20 DTE is one day below the default 21-DTE threshold; "
                "hook must warn (exit 1). Ensures the comparator uses <= not ==."
            ),
        ),

        # Custom threshold via env var: DTE=14 warns when threshold=14
        TestDTE(
            name="tt-require-dte / STO at 14 DTE, threshold=14 → WARN (exit 1)",
            payload_fn=lambda: _dte_order(
                _occ_symbol("AAPL", _date.today() + timedelta(days=14)),
                instrument_type="Equity Option",
                action="Sell to Open",
            ),
            hook="tt-require-dte",
            expected_exit=1,
            env={"TT_DTE_WARN_THRESHOLD": "14"},
            stdout_contains="WARNING",
            note=(
                "TT_DTE_WARN_THRESHOLD=14; STO option at exactly 14 DTE must trigger a warning."
            ),
        ),

        # Custom threshold via env var: DTE=15 is allowed when threshold=14
        TestDTE(
            name="tt-require-dte / STO at 15 DTE, threshold=14 → ALLOW (exit 0)",
            payload_fn=lambda: _dte_order(
                _occ_symbol("AAPL", _date.today() + timedelta(days=15)),
                instrument_type="Equity Option",
                action="Sell to Open",
            ),
            hook="tt-require-dte",
            expected_exit=0,
            env={"TT_DTE_WARN_THRESHOLD": "14"},
            stdout_absent="WARNING",
            note=(
                "TT_DTE_WARN_THRESHOLD=14; STO option at 15 DTE is above the threshold → silent."
            ),
        ),

        # Custom threshold via env var: DTE=13 warns when threshold=14 (below)
        TestDTE(
            name="tt-require-dte / STO at 13 DTE, threshold=14 → WARN (exit 1)",
            payload_fn=lambda: _dte_order(
                _occ_symbol("AAPL", _date.today() + timedelta(days=13)),
                instrument_type="Equity Option",
                action="Sell to Open",
            ),
            hook="tt-require-dte",
            expected_exit=1,
            env={"TT_DTE_WARN_THRESHOLD": "14"},
            stdout_contains="WARNING",
            note=(
                "TT_DTE_WARN_THRESHOLD=14; STO option at 13 DTE is one day below the custom threshold; "
                "hook must warn (exit 1). Ensures the comparator uses <= not ==."
            ),
        ),

        # 0DTE exemption: STO option expiring today → ALLOW (intraday entries are valid)
        TestDTE(
            name="tt-require-dte / STO at 0 DTE → ALLOW (0DTE exempt)",
            payload_fn=lambda: _dte_order(
                _occ_symbol("AAPL", _date.today()),
                instrument_type="Equity Option",
                action="Sell to Open",
            ),
            hook="tt-require-dte",
            expected_exit=0,
            stdout_absent="WARNING",
            note=(
                "0DTE entries are valid intraday positions; hook must exit silently even though "
                "DTE (0) is well below the default threshold."
            ),
        ),

        # Non-option instrument exemption: equity STO → ALLOW
        TestDTE(
            name="tt-require-dte / equity leg (non-option) → ALLOW (instrument exempt)",
            payload_fn=lambda: _dte_order(
                "AAPL",
                instrument_type="Equity",
                action="Sell to Open",
            ),
            hook="tt-require-dte",
            expected_exit=0,
            stdout_absent="WARNING",
            note=(
                "instrument-type='Equity' is not an option; hook must skip the leg and exit 0."
            ),
        ),

        # Closing order exemption: Sell to Close → ALLOW
        TestDTE(
            name="tt-require-dte / Sell to Close leg → ALLOW (closing order exempt)",
            payload_fn=lambda: _dte_order(
                _occ_symbol("AAPL", _date.today() + timedelta(days=5)),
                instrument_type="Equity Option",
                action="Sell to Close",
            ),
            hook="tt-require-dte",
            expected_exit=0,
            stdout_absent="WARNING",
            note=(
                "action='Sell to Close' is a closing order; hook must ignore it and exit 0 "
                "even though 5 DTE is inside the default threshold."
            ),
        ),

        # Unparseable expiry exemption: symbol with no embedded YYMMDD → ALLOW
        TestDTE(
            name="tt-require-dte / unparseable expiry symbol → ALLOW (expiry exempt)",
            payload_fn=lambda: _dte_order(
                "AAPL",
                instrument_type="Equity Option",
                action="Sell to Open",
            ),
            hook="tt-require-dte",
            expected_exit=0,
            stdout_absent="WARNING",
            note=(
                "Symbol 'AAPL' contains no parseable YYMMDD expiry; hook must skip it silently "
                "rather than raising an error or issuing a spurious warning."
            ),
        ),

        # Non-watched tool: tool_name not in WATCHED_TOOLS → ALLOW
        TestDTE(
            name="tt-require-dte / non-watched tool → ALLOW (tool bypassed)",
            payload_fn=lambda: {
                "tool_name": "get_positions",
                "tool_input": {
                    "legs": [
                        {
                            "instrument-type": "Equity Option",
                            "symbol": _occ_symbol("AAPL", _date.today() + timedelta(days=5)),
                            "action": "Sell to Open",
                            "quantity": 1,
                        }
                    ]
                },
            },
            hook="tt-require-dte",
            expected_exit=0,
            stdout_absent="WARNING",
            note=(
                "tool_name='get_positions' is not in WATCHED_TOOLS; hook must exit 0 immediately "
                "without inspecting the legs."
            ),
        ),

        # Invalid env var value: non-integer TT_DTE_WARN_THRESHOLD → falls back to 21
        TestDTE(
            name="tt-require-dte / invalid TT_DTE_WARN_THRESHOLD → fallback to 21, WARN at 21 DTE",
            payload_fn=lambda: _dte_order(
                _occ_symbol("AAPL", _date.today() + timedelta(days=21)),
                instrument_type="Equity Option",
                action="Sell to Open",
            ),
            hook="tt-require-dte",
            expected_exit=1,
            env={"TT_DTE_WARN_THRESHOLD": "not-a-number"},
            stdout_contains="WARNING",
            note=(
                "TT_DTE_WARN_THRESHOLD='not-a-number' is invalid; hook must log a fallback "
                "message to stderr and use the default threshold of 21 DTE, then warn on a "
                "21-DTE STO option."
            ),
        ),

        # Per-strategy threshold: iron_condor at exactly its threshold (30 DTE) → WARN
        TestDTE(
            name="tt-require-dte / iron_condor strategy at 30 DTE, per-strategy threshold=30 → WARN (exit 1)",
            payload_fn=lambda: _dte_order(
                _occ_symbol("SPX", _date.today() + timedelta(days=30)),
                instrument_type="Equity Option",
                action="Sell to Open",
                strategy="iron_condor",
            ),
            hook="tt-require-dte",
            expected_exit=1,
            env={"TT_DTE_THRESHOLDS": "iron_condor:30,covered_call:14"},
            stdout_contains="WARNING",
            note=(
                "TT_DTE_THRESHOLDS='iron_condor:30,covered_call:14'; order carries "
                "strategy='iron_condor'; STO option at exactly 30 DTE equals the "
                "per-strategy threshold → must warn."
            ),
        ),

        # Per-strategy threshold: iron_condor one day above its threshold (31 DTE) → ALLOW
        TestDTE(
            name="tt-require-dte / iron_condor strategy at 31 DTE, per-strategy threshold=30 → ALLOW (exit 0)",
            payload_fn=lambda: _dte_order(
                _occ_symbol("SPX", _date.today() + timedelta(days=31)),
                instrument_type="Equity Option",
                action="Sell to Open",
                strategy="iron_condor",
            ),
            hook="tt-require-dte",
            expected_exit=0,
            env={"TT_DTE_THRESHOLDS": "iron_condor:30,covered_call:14"},
            stdout_absent="WARNING",
            note=(
                "TT_DTE_THRESHOLDS='iron_condor:30,covered_call:14'; strategy='iron_condor'; "
                "STO option at 31 DTE is one day above the per-strategy threshold of 30 → silent."
            ),
        ),

        # Per-strategy threshold: covered_call at 14 DTE (its threshold) → WARN
        TestDTE(
            name="tt-require-dte / covered_call strategy at 14 DTE, per-strategy threshold=14 → WARN (exit 1)",
            payload_fn=lambda: _dte_order(
                _occ_symbol("AAPL", _date.today() + timedelta(days=14)),
                instrument_type="Equity Option",
                action="Sell to Open",
                strategy="covered_call",
            ),
            hook="tt-require-dte",
            expected_exit=1,
            env={"TT_DTE_THRESHOLDS": "iron_condor:30,covered_call:14"},
            stdout_contains="WARNING",
            note=(
                "TT_DTE_THRESHOLDS='iron_condor:30,covered_call:14'; strategy='covered_call'; "
                "STO option at exactly 14 DTE equals the per-strategy threshold → must warn."
            ),
        ),

        # Per-strategy threshold: covered_call above its threshold (15 DTE) → ALLOW
        TestDTE(
            name="tt-require-dte / covered_call strategy at 15 DTE, per-strategy threshold=14 → ALLOW (exit 0)",
            payload_fn=lambda: _dte_order(
                _occ_symbol("AAPL", _date.today() + timedelta(days=15)),
                instrument_type="Equity Option",
                action="Sell to Open",
                strategy="covered_call",
            ),
            hook="tt-require-dte",
            expected_exit=0,
            env={"TT_DTE_THRESHOLDS": "iron_condor:30,covered_call:14"},
            stdout_absent="WARNING",
            note=(
                "TT_DTE_THRESHOLDS='iron_condor:30,covered_call:14'; strategy='covered_call'; "
                "STO option at 15 DTE is one day above the per-strategy threshold of 14 → silent."
            ),
        ),

        # Per-strategy threshold overrides global: iron_condor at 22 DTE would pass the
        # global 21-DTE threshold but fails its own 30-DTE per-strategy threshold → WARN
        TestDTE(
            name="tt-require-dte / iron_condor at 22 DTE overrides global 21-DTE threshold → WARN (exit 1)",
            payload_fn=lambda: _dte_order(
                _occ_symbol("SPX", _date.today() + timedelta(days=22)),
                instrument_type="Equity Option",
                action="Sell to Open",
                strategy="iron_condor",
            ),
            hook="tt-require-dte",
            expected_exit=1,
            env={"TT_DTE_THRESHOLDS": "iron_condor:30"},
            stdout_contains="WARNING",
            note=(
                "TT_DTE_THRESHOLDS='iron_condor:30'; strategy='iron_condor'; 22 DTE is above "
                "the global 21-DTE threshold but below the iron_condor-specific 30-DTE threshold. "
                "The per-strategy threshold must take precedence → must warn."
            ),
        ),

        # Unknown strategy falls back to global threshold: strategy not in TT_DTE_THRESHOLDS
        # → uses global 21-DTE threshold; 21 DTE → WARN
        TestDTE(
            name="tt-require-dte / unknown strategy falls back to global threshold → WARN at 21 DTE (exit 1)",
            payload_fn=lambda: _dte_order(
                _occ_symbol("AAPL", _date.today() + timedelta(days=21)),
                instrument_type="Equity Option",
                action="Sell to Open",
                strategy="unknown_strategy",
            ),
            hook="tt-require-dte",
            expected_exit=1,
            env={"TT_DTE_THRESHOLDS": "iron_condor:30,covered_call:14"},
            stdout_contains="WARNING",
            note=(
                "TT_DTE_THRESHOLDS set but strategy='unknown_strategy' is not in the map; "
                "hook must fall back to the global 21-DTE threshold and warn at 21 DTE."
            ),
        ),

        # No strategy field in payload → uses global threshold as before
        TestDTE(
            name="tt-require-dte / no strategy field → global threshold applies → ALLOW at 22 DTE (exit 0)",
            payload_fn=lambda: _dte_order(
                _occ_symbol("AAPL", _date.today() + timedelta(days=22)),
                instrument_type="Equity Option",
                action="Sell to Open",
            ),
            hook="tt-require-dte",
            expected_exit=0,
            env={"TT_DTE_THRESHOLDS": "iron_condor:30,covered_call:14"},
            stdout_absent="WARNING",
            note=(
                "TT_DTE_THRESHOLDS set but order has no 'strategy' field; hook must use the "
                "global 21-DTE threshold. 22 DTE is above the threshold → silent."
            ),
        ),

        # -----------------------------------------------------------------------
        # tt-fetch-earnings-straddle tests
        # -----------------------------------------------------------------------

        # ATM straddle found for both underlyings → sidecar written with correct values
        TestSidecar(
            name="tt-fetch-earnings-straddle / AAPL+SPY greeks → sidecar written with correct implied moves",
            fixture="options_greeks_response.json",
            hook="tt-fetch-earnings-straddle",
            expected_exit=0,
            setup=remove_earnings_moves,
            teardown=remove_earnings_moves,
            stdout_contains="implied_move=",
            sidecar_has={
                # stock_price via put-call parity: S ≈ K + call − put
                # AAPL: S = 200 + 5.90 − 5.70 = 200.20; implied_move = 11.60/200.20
                "AAPL": (5.90 + 5.70) / (200.0 + 5.90 - 5.70),
                # SPY:  S = 540 + 4.20 − 4.00 = 540.20; implied_move = 8.20/540.20
                "SPY":  (4.20 + 4.00) / (540.0 + 4.20 - 4.00),
            },
            note=(
                "Full options_greeks_response fixture contains AAPL (ATM $200: call=5.90, put=5.70) "
                "and SPY (ATM $540: call=4.20, put=4.00). "
                "Hook must pick the call with delta closest to 0.50 as ATM, compute the straddle, "
                "divide by stock_price (put-call parity: K + call − put), "
                "and write both symbols to /tmp/tt_earnings_moves.json."
            ),
        ),

        # Existing sidecar entries are preserved (merge semantics)
        TestSidecar(
            name="tt-fetch-earnings-straddle / existing sidecar entry preserved on merge",
            fixture="options_greeks_response.json",
            hook="tt-fetch-earnings-straddle",
            expected_exit=0,
            setup=lambda: write_earnings_moves({"TSLA": 0.09}),
            teardown=remove_earnings_moves,
            sidecar_has={
                # AAPL stock_price via put-call parity: 200 + 5.90 − 5.70 = 200.20
                "AAPL": (5.90 + 5.70) / (200.0 + 5.90 - 5.70),
                "TSLA": 0.09,
            },
            note=(
                "If /tmp/tt_earnings_moves.json already contains a TSLA entry, the hook must "
                "preserve it while adding/updating AAPL and SPY from the greeks response."
            ),
        ),

        # Stdout confirms symbols written
        TestSidecar(
            name="tt-fetch-earnings-straddle / stdout reports each written symbol",
            fixture="options_greeks_response.json",
            hook="tt-fetch-earnings-straddle",
            expected_exit=0,
            setup=remove_earnings_moves,
            teardown=remove_earnings_moves,
            stdout_contains="AAPL",
            note=(
                "For each implied move written, the hook must print a line containing the "
                "symbol name so the session log is traceable."
            ),
        ),

        # Non-watched tool → exits 0 without touching the sidecar
        TestDTE(
            name="tt-fetch-earnings-straddle / non-watched tool → exits 0, sidecar untouched",
            payload_fn=lambda: {
                "tool_name": "get_market_metrics",
                "tool_input": {},
                "tool_response": [],
            },
            hook="tt-fetch-earnings-straddle",
            expected_exit=0,
            setup=remove_earnings_moves,
            teardown=remove_earnings_moves,
            stdout_absent="implied_move",
            note=(
                "tool_name='get_market_metrics' is not in WATCHED_TOOLS; the hook must exit 0 "
                "immediately without parsing the response or printing any implied_move output."
            ),
        ),

        # Empty / missing tool_response → exits 0 cleanly
        TestDTE(
            name="tt-fetch-earnings-straddle / empty tool_response → exits 0 cleanly",
            payload_fn=lambda: {
                "tool_name": "get_options_greeks",
                "tool_input": {},
                "tool_response": [],
            },
            hook="tt-fetch-earnings-straddle",
            expected_exit=0,
            setup=remove_earnings_moves,
            teardown=remove_earnings_moves,
            note=(
                "An empty tool_response list contains no option items. "
                "The hook must exit 0 without error and without creating the sidecar file."
            ),
        ),

        # -----------------------------------------------------------------------
        # tt-ff-stage2-exearn tests
        # Fixture: ff_stage2_greeks_response.json
        #   AAPL: front May16 IV=40%/35%/38% (195/200/205), back Jun20 IV=25%/24%/24%
        #   SPY:  front May16 IV=25%, back Jun20 IV=21%, single strike 540
        #
        # With implied_move=0.05, earnings May10 in AAPL front window (DTE=18):
        #   ex-earn front IVs: 195→~33.1%, 200→~26.8%, 205→~30.6%
        #   ex-earn FF_strike: 195=+32.2%, 200=+11.7%, 205=+27.5% → best=195
        # -----------------------------------------------------------------------

        # Ex-earn FF_strike computed and "BEST" strike identified (dynamic dates)
        TestDTE(
            name="ff_stage2_exearn / AAPL earnings in front window + sidecar → ex-earn FF_strike + BEST",
            payload_fn=lambda: _stage2_payload(
                _stage2_aapl_items(
                    _date.today() + timedelta(days=18),
                    _date.today() + timedelta(days=53),
                )
            ),
            hook="tt-ff-stage2-exearn",
            expected_exit=0,
            setup=lambda: [
                write_earnings_dates(
                    {"AAPL": (_date.today() + timedelta(days=12)).isoformat()}
                ),
                write_earnings_moves({"AAPL": 0.05}),
            ],
            teardown=lambda: [remove_earnings_dates(), remove_earnings_moves()],
            stdout_contains="ex-earn",
            note=(
                "AAPL: front +18d IVs elevated by earnings (+12d, in front window). "
                "Sidecar provides implied_move=5%. Hook must strip earnings variance from "
                "front IVs and report ex-earn FF_strike per strike, labelling the best."
            ),
        ),

        # Best strike identified as AAPL 195C (highest ex-earn FF_strike) (dynamic dates)
        TestDTE(
            name="ff_stage2_exearn / AAPL earnings in front window + sidecar → best strike reported",
            payload_fn=lambda: _stage2_payload(
                _stage2_aapl_items(
                    _date.today() + timedelta(days=18),
                    _date.today() + timedelta(days=53),
                )
            ),
            hook="tt-ff-stage2-exearn",
            expected_exit=0,
            setup=lambda: [
                write_earnings_dates(
                    {"AAPL": (_date.today() + timedelta(days=12)).isoformat()}
                ),
                write_earnings_moves({"AAPL": 0.05}),
            ],
            teardown=lambda: [remove_earnings_dates(), remove_earnings_moves()],
            stdout_contains="BEST",
            note=(
                "After ex-earn stripping, 195C has the highest ex-earn FF_strike. "
                "Hook must mark it with 'BEST' in the output table."
            ),
        ),

        # Earnings date known but no implied_move in sidecar → falls back to advisory note (dynamic dates)
        TestDTE(
            name="ff_stage2_exearn / AAPL earnings in front window + no implied_move sidecar → sidecar note",
            payload_fn=lambda: _stage2_payload(
                _stage2_aapl_items(
                    _date.today() + timedelta(days=18),
                    _date.today() + timedelta(days=53),
                )
            ),
            hook="tt-ff-stage2-exearn",
            expected_exit=0,
            setup=lambda: [
                write_earnings_dates(
                    {"AAPL": (_date.today() + timedelta(days=12)).isoformat()}
                ),
                remove_earnings_moves(),
            ],
            teardown=lambda: [remove_earnings_dates(), remove_earnings_moves()],
            stdout_contains="no implied move in sidecar",
            note=(
                "Earnings date is known (AAPL +12d, in front window) but "
                "tt_earnings_moves.json is absent. Hook must note that raw IVs are used "
                "and prompt the user to populate the sidecar."
            ),
        ),

        # No earnings dates sidecar at all → clean raw FF_strike output (no ex-earn labels) (dynamic dates)
        TestDTE(
            name="ff_stage2_exearn / no earnings sidecars → raw FF_strike reported, no ex-earn label",
            payload_fn=lambda: _stage2_payload(
                _stage2_aapl_items(
                    _date.today() + timedelta(days=18),
                    _date.today() + timedelta(days=53),
                )
            ),
            hook="tt-ff-stage2-exearn",
            expected_exit=0,
            setup=lambda: [remove_earnings_dates(), remove_earnings_moves()],
            teardown=lambda: [remove_earnings_dates(), remove_earnings_moves()],
            stdout_contains="STAGE 2 FF_STRIKE SCAN",
            stdout_absent="ex-earn",
            note=(
                "Neither tt_earnings_dates.json nor tt_earnings_moves.json is present. "
                "Hook must emit a clean FF_strike scan with no ex-earn labels or adjustments."
            ),
        ),

        # Non-watched tool → exits silently
        TestDTE(
            name="ff_stage2_exearn / non-watched tool → silent (exit 0)",
            payload_fn=lambda: {
                "tool_name": "get_market_metrics",
                "tool_input": {},
                "tool_response": [],
            },
            hook="tt-ff-stage2-exearn",
            expected_exit=0,
            stdout_absent="STAGE 2",
            note=(
                "tool_name='get_market_metrics' is not in WATCHED_TOOLS; "
                "hook must exit 0 immediately without printing any output."
            ),
        ),

        # All strikes in contango (front < back) → "do NOT enter" Stage 2 hard gate
        TestDTE(
            name="ff_stage2_exearn / all strikes in contango (front IV < back IV) → do NOT enter",
            payload_fn=lambda: {
                "tool_name": "get_options_greeks",
                "tool_input": {},
                "tool_response": [
                    {
                        "type": "text",
                        "text": json.dumps({
                            "data": {
                                "items": [
                                    {
                                        "symbol": ".CONTG260516C00100000",
                                        "underlying-symbol": "CONTG",
                                        "option-type": "C",
                                        "strike-price": "100.0",
                                        "implied-volatility": 0.20,
                                    },
                                    {
                                        "symbol": ".CONTG260620C00100000",
                                        "underlying-symbol": "CONTG",
                                        "option-type": "C",
                                        "strike-price": "100.0",
                                        "implied-volatility": 0.28,
                                    },
                                    {
                                        "symbol": ".CONTG260516C00105000",
                                        "underlying-symbol": "CONTG",
                                        "option-type": "C",
                                        "strike-price": "105.0",
                                        "implied-volatility": 0.19,
                                    },
                                    {
                                        "symbol": ".CONTG260620C00105000",
                                        "underlying-symbol": "CONTG",
                                        "option-type": "C",
                                        "strike-price": "105.0",
                                        "implied-volatility": 0.25,
                                    },
                                ]
                            }
                        }),
                    }
                ],
            },
            hook="tt-ff-stage2-exearn",
            expected_exit=0,
            stdout_contains="do NOT enter",
            note=(
                "Synthetic 'CONTG' underlying: both strikes have front IV < back IV "
                "(contango at all strikes). Hook must emit the Stage 2 hard-gate message "
                "'do NOT enter' to block calendar entry per forward-factor.md."
            ),
        ),

        # -----------------------------------------------------------------------
        # tt-populate-earnings-dates tests
        # Fixture: ff_exit_monitor_full_response.json
        #   AAPL: earnings-next-date=2026-05-10
        #   SPY:  earnings-next-date=2026-05-25
        #   ES:   no earnings-next-date field
        # -----------------------------------------------------------------------

        # Full response → AAPL and SPY dates written, ES skipped
        TestSidecarDates(
            name="tt-populate-earnings-dates / full response → AAPL+SPY dates written, ES absent",
            fixture="ff_exit_monitor_full_response.json",
            hook="tt-populate-earnings-dates",
            expected_exit=0,
            setup=remove_earnings_dates,
            teardown=remove_earnings_dates,
            stdout_contains="AAPL",
            sidecar_has={"AAPL": "2026-05-10", "SPY": "2026-05-25"},
            sidecar_absent=["ES"],
            note=(
                "get_market_metrics(detail='full') response contains AAPL (2026-05-10) "
                "and SPY (2026-05-25) with earnings-next-date, and ES without. "
                "Hook must write both dated symbols and omit ES."
            ),
        ),

        # Merge: pre-existing TSLA entry is preserved alongside new entries
        TestSidecarDates(
            name="tt-populate-earnings-dates / existing sidecar entry preserved on merge",
            fixture="ff_exit_monitor_full_response.json",
            hook="tt-populate-earnings-dates",
            expected_exit=0,
            setup=lambda: write_earnings_dates({"TSLA": "2026-08-01"}),
            teardown=remove_earnings_dates,
            sidecar_has={"AAPL": "2026-05-10", "SPY": "2026-05-25", "TSLA": "2026-08-01"},
            note=(
                "If /tmp/tt_earnings_dates.json already contains a TSLA entry, the hook "
                "must preserve it while adding/updating AAPL and SPY from the response."
            ),
        ),

        # Stdout reports each written symbol
        TestSidecarDates(
            name="tt-populate-earnings-dates / stdout reports each written symbol",
            fixture="ff_exit_monitor_full_response.json",
            hook="tt-populate-earnings-dates",
            expected_exit=0,
            setup=remove_earnings_dates,
            teardown=remove_earnings_dates,
            stdout_contains="SPY",
            note=(
                "For each earnings date written the hook must print a line containing "
                "the symbol name so the session log is traceable."
            ),
        ),

        # Non-watched tool (get_options_greeks) → exits 0, sidecar untouched
        TestDTE(
            name="tt-populate-earnings-dates / non-watched tool → exits 0, sidecar untouched",
            payload_fn=lambda: {
                "tool_name": "get_options_greeks",
                "tool_input": {"detail": "full"},
                "tool_response": [],
            },
            hook="tt-populate-earnings-dates",
            expected_exit=0,
            setup=remove_earnings_dates,
            teardown=remove_earnings_dates,
            stdout_absent="earnings-next-date",
            note=(
                "tool_name='get_options_greeks' is not in WATCHED_TOOLS; the hook must "
                "exit 0 immediately without parsing the response or writing the sidecar."
            ),
        ),

        # Watched tool but detail != "full" → exits 0, sidecar untouched
        TestDTE(
            name="tt-populate-earnings-dates / detail != full → exits 0, sidecar untouched",
            payload_fn=lambda: {
                "tool_name": "get_market_metrics",
                "tool_input": {"symbols": ["AAPL"], "detail": "standard"},
                "tool_response": [],
            },
            hook="tt-populate-earnings-dates",
            expected_exit=0,
            setup=remove_earnings_dates,
            teardown=remove_earnings_dates,
            stdout_absent="earnings-next-date",
            note=(
                "tool_name='get_market_metrics' is watched but detail='standard' (not 'full'). "
                "The hook must exit 0 without writing the sidecar — earnings-next-date fields "
                "are only present in full responses."
            ),
        ),

        # Empty tool_response with detail=full → exits 0 cleanly, no sidecar created
        TestDTE(
            name="tt-populate-earnings-dates / empty tool_response (detail=full) → exits 0 cleanly",
            payload_fn=lambda: {
                "tool_name": "get_market_metrics",
                "tool_input": {"symbols": [], "detail": "full"},
                "tool_response": [],
            },
            hook="tt-populate-earnings-dates",
            expected_exit=0,
            setup=remove_earnings_dates,
            teardown=remove_earnings_dates,
            note=(
                "An empty tool_response list yields no earnings dates. "
                "The hook must exit 0 without error and without creating the sidecar file."
            ),
        ),

        # Pruning: stale sidecar entry (yesterday) is removed, future entry kept
        TestDTESidecarDates(
            name="tt-populate-earnings-dates / stale sidecar entry pruned, future entry kept",
            payload_fn=lambda: {
                "tool_name": "get_market_metrics",
                "tool_input": {"detail": "full"},
                "tool_response": [
                    {
                        "type": "text",
                        "text": json.dumps({
                            "data": {
                                "items": [
                                    {
                                        "symbol": "NVDA",
                                        "earnings-next-date": (_date.today() + timedelta(days=30)).isoformat(),
                                    }
                                ]
                            }
                        }),
                    }
                ],
            },
            hook="tt-populate-earnings-dates",
            expected_exit=0,
            setup=lambda: write_earnings_dates({
                "STALE": (_date.today() - timedelta(days=1)).isoformat(),
                "NVDA": (_date.today() + timedelta(days=30)).isoformat(),
            }),
            teardown=remove_earnings_dates,
            sidecar_has={"NVDA": (_date.today() + timedelta(days=30)).isoformat()},
            sidecar_absent=["STALE"],
            note=(
                "An existing sidecar entry whose date is yesterday (already passed) "
                "must be pruned when the merged file is written.  The future NVDA entry "
                "must survive."
            ),
        ),

        # Pruning: today's date is not stale (>= today), must be kept
        TestDTESidecarDates(
            name="tt-populate-earnings-dates / today's date is not stale, kept in sidecar",
            payload_fn=lambda: {
                "tool_name": "get_market_metrics",
                "tool_input": {"detail": "full"},
                "tool_response": [
                    {
                        "type": "text",
                        "text": json.dumps({
                            "data": {
                                "items": [
                                    {
                                        "symbol": "MSFT",
                                        "earnings-next-date": (_date.today() + timedelta(days=14)).isoformat(),
                                    }
                                ]
                            }
                        }),
                    }
                ],
            },
            hook="tt-populate-earnings-dates",
            expected_exit=0,
            setup=lambda: write_earnings_dates({
                "TODAY": _date.today().isoformat(),
            }),
            teardown=remove_earnings_dates,
            sidecar_has={
                "TODAY": _date.today().isoformat(),
                "MSFT": (_date.today() + timedelta(days=14)).isoformat(),
            },
            note=(
                "An existing entry whose date equals today must NOT be pruned "
                "(the pruning threshold is strictly < today)."
            ),
        ),

        # Pruning: multiple stale entries are all removed, leaving only future ones
        TestDTESidecarDates(
            name="tt-populate-earnings-dates / multiple stale entries pruned, future entries survive",
            payload_fn=lambda: {
                "tool_name": "get_market_metrics",
                "tool_input": {"detail": "full"},
                "tool_response": [
                    {
                        "type": "text",
                        "text": json.dumps({
                            "data": {
                                "items": [
                                    {
                                        "symbol": "AMD",
                                        "earnings-next-date": (_date.today() + timedelta(days=60)).isoformat(),
                                    }
                                ]
                            }
                        }),
                    }
                ],
            },
            hook="tt-populate-earnings-dates",
            expected_exit=0,
            setup=lambda: write_earnings_dates({
                "OLD1": (_date.today() - timedelta(days=90)).isoformat(),
                "OLD2": (_date.today() - timedelta(days=1)).isoformat(),
                "FUTURE": (_date.today() + timedelta(days=45)).isoformat(),
            }),
            teardown=remove_earnings_dates,
            sidecar_has={
                "FUTURE": (_date.today() + timedelta(days=45)).isoformat(),
                "AMD": (_date.today() + timedelta(days=60)).isoformat(),
            },
            sidecar_absent=["OLD1", "OLD2"],
            note=(
                "Multiple stale entries (90 days ago and yesterday) must all be pruned. "
                "Pre-existing FUTURE entry and newly written AMD must both survive."
            ),
        ),

        # Single call + single put with OCC symbols containing expiry → straddle computed
        TestDTE(
            name="tt-fetch-earnings-straddle / single call + single put same strike → straddle computed",
            payload_fn=lambda: {
                "tool_name": "get_options_greeks",
                "tool_input": {},
                "tool_response": [
                    {
                        "type": "text",
                        "text": json.dumps({
                            "data": {
                                "items": [
                                    {
                                        "symbol": ".XYZ270615C00100000",
                                        "underlying-symbol": "XYZ",
                                        "option-type": "C",
                                        "strike-price": "100.0",
                                        "bid": 3.00,
                                        "ask": 3.40,
                                        "mark": 3.20,
                                        "delta": 0.50,
                                    },
                                    {
                                        "symbol": ".XYZ270615P00100000",
                                        "underlying-symbol": "XYZ",
                                        "option-type": "P",
                                        "strike-price": "100.0",
                                        "bid": 3.10,
                                        "ask": 3.50,
                                        "mark": 3.30,
                                        "delta": -0.50,
                                    },
                                ]
                            }
                        }),
                    }
                ],
            },
            hook="tt-fetch-earnings-straddle",
            expected_exit=0,
            setup=remove_earnings_moves,
            teardown=remove_earnings_moves,
            stdout_contains="XYZ",
            note=(
                "A minimal payload with a single call+put pair at strike $100, "
                "option symbols containing expiry 2027-06-15. "
                "Straddle = 3.20+3.30 = 6.50; stock_price via put-call parity = "
                "100 + 3.20 − 3.30 = 99.90; implied_move = 6.50/99.90 ≈ 0.0651. "
                "Hook must compute and write the result, then print XYZ in stdout."
            ),
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
