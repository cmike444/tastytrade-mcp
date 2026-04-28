#!/usr/bin/env python3
"""
Mock replacement for tt-fetch-earnings-straddle.py --fetch mode.

Used exclusively in automated tests via the TT_STRADDLE_HOOK env var.
Writes a hard-coded implied_move for the requested underlying to the
standard sidecar path without making any network calls.

Hard-coded moves per underlying:
    AAPL → 0.04   (4% — sufficient to produce a valid ex-earn FF for the
                   AAPL front-window FF-exit-monitor integration test)
    SPY  → 0.02   (2%)
    *    → 0.05   (5% fallback for any other underlying)
"""
import json
import os
import sys
import tempfile

SIDECAR_PATH = "/tmp/tt_earnings_moves.json"
MOCK_MOVES = {"AAPL": 0.04, "SPY": 0.02}

if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) < 3 or args[0] != "--fetch":
        print("mock_straddle_fetch: usage --fetch UNDERLYING EXPIRY_ISO", file=sys.stderr)
        sys.exit(1)

    underlying = args[1].upper()
    implied_move = MOCK_MOVES.get(underlying, 0.05)

    try:
        existing = {}
        if os.path.exists(SIDECAR_PATH):
            with open(SIDECAR_PATH) as f:
                existing = json.load(f)
        if not isinstance(existing, dict):
            existing = {}
    except (json.JSONDecodeError, OSError):
        existing = {}

    existing[underlying] = implied_move

    tmp_dir = os.path.dirname(SIDECAR_PATH)
    fd, tmp_path = tempfile.mkstemp(dir=tmp_dir, suffix=".json")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(existing, f)
        os.replace(tmp_path, SIDECAR_PATH)
    except OSError as e:
        print(f"mock_straddle_fetch: write failed: {e}", file=sys.stderr)
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        sys.exit(1)

    print(
        f"mock_straddle_fetch: wrote implied_move={implied_move:.4f} for {underlying}",
        flush=True,
    )
    sys.exit(0)
