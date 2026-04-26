# Account Acceleration Framework

## Purpose

This document defines the tiered sequence for growing a trading account. The framework is not a growth "goal" — it is an operating protocol. Each tier must be completed in order. Skipping tiers or running multiple tiers simultaneously is not permitted.

The rationale: sustainable account growth comes from executing the right actions in the right sequence. Process discipline generates consistent edge. Diversification spreads that edge across uncorrelated strategies. Only after those foundations are solid does additional capital amplify results. Increasing position size without Tier 1 and Tier 2 in place amplifies losses, not gains.

---

## The Four Tiers

### Tier 1 — Process Discipline

**Focus:** Execute every rule on every trade, every session, without exception.

**What this means:**
- Every short-premium entry is placed as an OTOCO with 50% profit / 2× credit brackets live at fill
- Every VRP position is closed or rolled by 21 DTE — no exceptions, no waiting for "a little more time"
- No single underlying exceeds 25% of net liq in VRP exposure
- Every trade has a pre-trade written plan (thesis / profit / stop / time stop / invalidation) documented before the order is placed
- No trades placed on 0DTE VRP blackout days (FOMC, CPI, NFP, PCE, PPI, GDP)
- 0DTE circuit breakers enforced: $250 daily / $1,500 weekly halt, no exceptions

**Advancement criterion:** Zero Tier 1 violations in a rolling 30-calendar-day window.

**Violations that reset the 30-day clock:**
- Entry placed without an OTOCO bracket where one was required
- Position held past the 21-DTE time stop
- Single-name VRP concentration exceeds 25% of net liq
- Trade placed without a pre-trade written plan
- 0DTE trade on a blackout day
- 0DTE trade after a circuit breaker was triggered

**Why Tier 1 must come first:** Every other tier amplifies the process — good or bad. A trader who adds capital (Tier 3) or increases sizing (Tier 4) without clean Tier 1 execution compounds rule violations into larger losses. The 30-day window is non-negotiable.

---

### Tier 2 — Strategy Diversification

**Focus:** Run at least 3 concurrent strategies from the seven-strategy playbook at all times.

**What this means:**
- The portfolio holds active positions in 3 or more different strategies simultaneously (not sequentially)
- Strategies are chosen to provide uncorrelated exposure: for example, VRP (short vol) + Forward Factor (calendar) + Supply and Demand Zones (directional) + 0DTE VRP (intraday) covers four distinct edge sources
- The 3-strategy minimum applies when capital allows — small accounts with limited buying power may need to phase in; document the plan for reaching 3 strategies as capital grows
- Adding the same strategy on a different underlying does not count as a second strategy

**Advancement criterion:** Sustained 3+ concurrent strategies for a rolling 30-calendar-day window while maintaining Tier 1 compliance.

**Why diversification before capital injection:** A single-strategy account with concentrated vol exposure can be wiped out in a single event (e.g., a vol spike in the one name you're short). Adding strategies before adding capital means injected capital is deployed into a more resilient, diversified portfolio from day one.

---

### Tier 3 — Capital Injection

**Focus:** Add external capital to the account.

**What this means:**
- Transfer savings, bonus, or proceeds from other accounts into the trading account
- The amount and timing depends on personal financial circumstances — this is not a target amount, it is an action category
- Capital should only be added when Tier 1 and Tier 2 are both sustained — injecting capital into a portfolio with broken process or insufficient diversification is not advised

**Advancement criterion:** Capital has been added and deployed across the active strategy mix. Tier 1 and Tier 2 remain in compliance.

**Why capital injection comes after process and diversification:** Adding capital to a well-run, diversified portfolio scales positive expected value. Adding capital to a poorly-run or concentrated portfolio scales risk. The sequence protects the injected capital.

---

### Tier 4 — Sizing Increases

**Focus:** Increase the Kelly fraction or per-trade allocation.

**What this means:**
- Raise the default per-trade allocation from the baseline (2–4% of portfolio) toward the upper range (6–8%) incrementally
- Raise the Kelly fraction used for strategy-specific sizing tables
- Sizing increases apply across all strategies proportionally — do not increase sizing in only one strategy

**Advancement criterion:** Tier 1–3 are all sustained. The account has demonstrated positive realized P&L over a meaningful sample (at minimum 3+ months of trading across multiple strategies). Sizing increases are made in increments (e.g., +0.5% per-trade allocation per month) rather than all at once.

**Why sizing is last:** A larger Kelly fraction applied to a small, undiversified, or undisciplined portfolio produces larger drawdowns and psychological distress that causes further rule-breaking. The compounding effect of sizing is most beneficial when the underlying process is already generating consistent edge.

---

## EOD Tier 1 Audit

The End-of-Day report includes an Acceleration Check (step 7) that audits Tier 1 compliance for the session. This check enumerates any violations explicitly. The 30-day clean window required for Tier 2 advancement cannot be self-assessed — it must come from the systematic EOD audit record.

Maintain a running log of sessions with zero violations. When the log shows 30 consecutive calendar days with no violations, the advancement criterion for Tier 2 is met.

---

## Tier Summary Table

| Tier | Name | Criterion to Advance |
|---|---|---|
| 1 | Process Discipline | Zero violations in rolling 30-day window |
| 2 | Strategy Diversification | ≥3 concurrent strategies sustained for 30 days with Tier 1 clean |
| 3 | Capital Injection | Capital added and deployed; Tier 1 + 2 in compliance |
| 4 | Sizing Increases | Tier 1–3 sustained; 3+ months positive P&L; incremental increases only |

---

## Common Mistakes

- **Skipping to Tier 4 first** — increasing sizing before process is clean turns rule violations into large losses
- **Treating Tier 1 violations as minor** — every violation resets the 30-day clock; there are no "small" violations
- **Counting the same strategy on different tickers as strategy diversification** — two VRP strangles on different names is still one strategy
- **Injecting capital during a losing streak** — capital injection is a Tier 3 action that follows process and diversification, not a response to losses that need to be recovered
- **Running tiers simultaneously** — adding capital and increasing sizing at the same time removes the ability to isolate which variable is causing results
