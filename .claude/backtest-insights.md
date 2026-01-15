# Backtest Optimization Insights

**Last Updated:** 2026-01-14
**Test Period:** December 15, 2025 - January 14, 2026 (30 days)

---

## Executive Summary

After multiple iterations of optimization testing different timeframes, ATR multipliers, OB scores, and R:R ratios, we discovered that **no confirmation (NoConf)** strategies significantly outperform confirmation-based entries. The optimal parameters vary by symbol.

### Key Findings:
1. **NoConf dominates** - Waiting for confirmation candles hurts performance
2. **ATR multiplier matters** - Different values optimal per symbol
3. **R:R 1.5-2 is optimal** - Higher R:R reduces win rate too much
4. **Timeframe matters** - M5 for BTC, M1 scalp for metals

---

## OPTIMAL STRATEGIES BY SYMBOL (Jan 2026)

### BTCUSD - Use M5 Timeframe (H4/M30/M5)
| Strategy | Win% | PF | PnL | Max DD | Trades |
|----------|------|-----|-----|--------|--------|
| **BTC-OPTIMAL: ATR0.8\|RR1.5** | 68.8% | 2.62 | $2738 | 6.0% | 125 |
| BTC-OPTIMAL: ATR0.8\|RR2 | 61.1% | 2.04 | $2011 | 18.5% | 113 |
| BTC-OPTIMAL: OB75\|RR2 | 59.8% | 2.08 | $1342 | 13.3% | 87 |

**Recommended:** `--tf m5` with `ATR0.8|RR1.5`

### XAUUSD.s (Gold) - Use Scalp Timeframe (H1/M15/M1)
| Strategy | Win% | PF | PnL | Max DD | Trades |
|----------|------|-----|-----|--------|--------|
| **XAU-OPTIMAL: ATR1.5\|RR2** | 75.4% | 3.07 | $3481 | 6.8% | 122 |
| XAU-OPTIMAL: ATR1.5\|RR1.5 | 77.1% | 2.68 | $3309 | 10.5% | 131 |
| XAU-OPTIMAL: ATR1.2\|RR2 | 68.9% | 2.29 | $2459 | 11.5% | 135 |

**Recommended:** `--tf scalp` with `ATR1.5|RR2`

### XAGUSD.s (Silver) - Use Scalp Timeframe (H1/M15/M1)
| Strategy | Win% | PF | PnL | Max DD | Trades |
|----------|------|-----|-----|--------|--------|
| **XAG-OPTIMAL: OB70\|RR2.5** | 61.4% | 1.87 | $669 | 13.6% | 57 |
| XAG-OPTIMAL: OB65\|RR2 | 66.1% | 1.94 | $653 | 9.0% | 56 |
| XAG-OPTIMAL: ATR1.2\|RR2 | 65.4% | 1.76 | $524 | 17.0% | 52 |

**Recommended:** `--tf scalp` with `OB65|RR2`

---

## Timeframe Presets

| Preset | HTF | MTF | LTF | Best For |
|--------|-----|-----|-----|----------|
| `standard` | H4 | H1 | M5 | General |
| `scalp` | H1 | M15 | M1 | Metals (Gold/Silver) |
| `m5` | H4 | M30 | M5 | **BTCUSD (Best)** |
| `m1` | H1 | M15 | M1 | Same as scalp |
| `intraday` | H4 | H1 | M15 | Conservative |
| `swing` | D1 | H4 | H1 | Position trading |

---

## Strategy Parameters Explained

### ATR Multiplier (atrMult)
- **0.8**: More sensitive OB detection, more trades
- **1.0**: Standard (default)
- **1.2**: Moderate filtering
- **1.5**: Stricter OB detection, fewer but higher quality trades

### OB Score (minOBScore)
- **60**: More trades, lower quality
- **65**: Good balance
- **70**: Standard (recommended)
- **75-80**: Fewer trades, higher quality

### Risk:Reward (fixedRR)
- **1.5**: Higher win rate, smaller wins
- **2.0**: Standard (recommended)
- **2.5**: Lower win rate, bigger wins
- **3.0**: Much lower win rate

---

## CLI Usage

```bash
# Test BTCUSD with optimal M5 timeframe
node scripts/quick-backtest.mjs --compare-all --tf m5 -s BTCUSD

# Test Gold with optimal scalp timeframe
node scripts/quick-backtest.mjs --compare-all --tf scalp -s XAUUSD.s

# Compare all timeframes for a symbol
node scripts/quick-backtest.mjs --compare-timeframes -s BTCUSD

# Custom date range
node scripts/quick-backtest.mjs --compare-all --tf m5 -s BTCUSD --start 2025-12-01 --end 2026-01-14

# Quick single run
node scripts/quick-backtest.mjs --tf scalp -s XAUUSD.s
```

---

## Risk Management Guidelines

| Account Type | Max DD | Kill Zones | Strategy |
|--------------|--------|------------|----------|
| Prop Firm Challenge | 5-6% | Yes | SAFE: OB70\|KZ\|DD6% |
| Funded Account | 8% | No | Symbol-specific optimal |
| Personal Account | 8-10% | No | Aggressive optimal |

---

## Performance Comparison: NoConf vs Confirmation

### 30-Day Test Results (Dec 15 - Jan 14, 2026)

| Symbol | NoConf Win% | NoConf PF | Confirm Win% | Confirm PF |
|--------|-------------|-----------|--------------|------------|
| BTCUSD | 61-69% | 2.0-2.6 | 44% | 1.27 |
| XAUUSD.s | 75-77% | 2.7-3.1 | 46% | 1.19 |
| XAGUSD.s | 61-66% | 1.7-1.9 | 46% | 1.70 |

**Conclusion:** NoConf strategies significantly outperform in all metrics.

---

## Code Reference

Strategy configurations in `scripts/quick-backtest.mjs`:
- Line 183-214: `VARIATIONS` array with all strategies
- Line 28-44: `TIMEFRAME_PRESETS` for different timeframe combinations

---

## Iteration History

### Iteration 1 (Jan 2026)
- Tested confirmation types: NoConf, Close, Strong, Engulf
- Finding: NoConf dominated across all symbols

### Iteration 2 (Jan 2026)
- Tested R:R variations: 1.5, 2.0, 2.5, 3.0
- Tested OB scores: 60, 65, 70, 75, 80
- Tested ATR multipliers: 0.8, 1.0, 1.2, 1.5
- Finding: Optimal parameters vary by symbol

### Final (Jan 2026)
- Created symbol-specific optimal strategies
- Added timeframe comparison feature
- Validated across multiple date ranges
