# Backtest Optimization Insights

**Last Updated:** 2026-02-11
**Test Period:** January 22 - February 11, 2026 (20 days)
**Variations Tested:** 141 per symbol across 2 iteration rounds

---

## Executive Summary

After 2 rounds of optimization testing 141 strategy variations per symbol over 20 days, we found:
- **All symbols perform best on Scalp (H1/M15/M1)** - including BTCUSD which was 10x better than M5
- **NoFilter OB (minOBScore=0)** dominates for BTC and Gold
- **Breakeven at 0.75R** consistently improves risk-adjusted returns
- **ATR2.0** gives highest win rates (83-89%) but fewer trades
- **Tiered TP with low R** (50@0.5R|30@1R|20@1.5R) is optimal for Silver

### Key Findings:
1. **BTCUSD on Scalp** - Switched from M5 to H1/M15/M1, went from $215 to $2,071 (10x!)
2. **NoFilter OB** - minOBScore=0 with ATR filtering outperforms strict OB score filtering
3. **Breakeven at 0.75R** - Better than 1.0R; locks profits earlier while letting winners run
4. **R:R 2.0-3.0** - Higher RR works when combined with BE (protects downside)
5. **Scalp timeframe universal** - H1/M15/M1 is now best for ALL symbols

---

## OPTIMAL STRATEGIES BY SYMBOL (Feb 2026)

### BTCUSD - Scalp Timeframe (H1/M15/M1) - **NEW!**
| Strategy | Trades | Win% | PF | PnL | Max DD |
|----------|--------|------|-----|-----|--------|
| **EVERY-OB: ATR1.5\|RR2** | 86 | 70.9% | 3.35 | $2,071 | 7.6% |
| ATR2.0-BE: RR3\|BE0.75R | 80 | 83.8% | 5.25 | $1,650 | 7.5% |
| ATR2.0: NoFilter\|RR3 | 65 | 73.8% | 4.31 | $1,579 | 9.8% |
| TIERED: 50@0.5R\|30@1R\|20@1.5R | 138 | 81.2% | 2.72 | $1,537 | 10.9% |

**Recommended:** `--tf scalp` with `ATR1.5|RR2` (NoFilter)
**High WR alternative:** `ATR2.0|RR3|BE0.75R` (83.8% WR, PF 5.25)

### XAUUSD.s (Gold) - Scalp Timeframe (H1/M15/M1)
| Strategy | Trades | Win% | PF | PnL | Max DD |
|----------|--------|------|-----|-----|--------|
| **EVERY-OB: NoFilter\|RR2.5** | 65 | 83.1% | 6.44 | $2,311 | 4.9% |
| BE: 0.75R\|RR3\|3pips | 73 | 84.9% | 7.72 | $2,215 | 3.9% |
| EVERY-OB-BE: NoFilter\|RR2.5\|BE1R | 71 | 84.5% | 7.48 | $2,221 | 4.9% |
| ATR2.0-BE: RR3\|BE0.75R | 28 | 89.3% | 9.09 | $1,074 | 2.2% |

**Recommended:** `--tf scalp` with `NoFilter|RR2.5`
**Safe alternative:** `OB70|RR3|BE0.75R` (84.9% WR, 3.9% MaxDD - great for prop firms)

### XAGUSD.s (Silver) - Scalp Timeframe (H1/M15/M1)
| Strategy | Trades | Win% | PF | PnL | Max DD |
|----------|--------|------|-----|-----|--------|
| **TIERED: 50@0.5R\|30@1R\|20@1.5R** | 164 | 80.5% | 2.95 | $3,066 | 7.7% |
| TIERED+BE: 50@1R\|30@2R\|20@3R\|BE0.75R | 135 | 77.8% | 3.06 | $2,810 | 10.2% |
| EVERY-OB: NoFilter\|RR3 | 127 | 63.8% | 2.38 | $2,803 | 19.4% |
| BE: 1R\|RR2\|5pips | 150 | 73.3% | 2.56 | $2,800 | 11.1% |

**Recommended:** `--tf scalp` with `TIERED 50@0.5R|30@1R|20@1.5R`

---

## Timeframe Presets

| Preset | HTF | MTF | LTF | Best For |
|--------|-----|-----|-----|----------|
| **`scalp`** | H1 | M15 | M1 | **ALL symbols (Feb 2026 best)** |
| `standard` | H4 | H1 | M5 | General |
| `m5` | H4 | M30 | M5 | Legacy BTC (outdated) |
| `m1` | H1 | M15 | M1 | Same as scalp |
| `intraday` | H4 | H1 | M15 | Conservative |
| `swing` | D1 | H4 | H1 | Position trading |

---

## Strategy Parameters Explained

### ATR Multiplier (atrMult)
- **1.0**: Standard (default for Gold/Silver)
- **1.5**: **Best for BTCUSD** - filters to higher quality OBs
- **2.0**: Highest win rates (83-89%) but fewer trades - great for prop firms

### OB Score (minOBScore)
- **0**: **NoFilter** - take every OB (best when combined with ATR filtering)
- **70**: Standard quality filter (best for Silver tiered TP)
- **75-80**: Very strict - too few trades

### Risk:Reward (fixedRR)
- **1.5**: Higher win rate, good for tiered TP final target
- **2.0**: Standard (best for BTC with ATR1.5)
- **2.5**: Best for Gold NoFilter OB
- **3.0**: Best with breakeven at 0.75R (protects against losses)

### Breakeven (BE)
- **0.75R trigger**: Move SL to entry when trade reaches 0.75R profit - **best overall**
- **1.0R trigger**: Standard - slightly worse than 0.75R
- **Buffer 3-5 pips**: Lock in small profit above entry

### Tiered TP
- **50@0.5R|30@1R|20@1.5R**: Scalp quick - best for Silver ($3,066 in 20 days)
- **50@1R|30@2R|20@3R**: Balanced runner with BE
- **30@1R|30@2R|40@4R**: Aggressive runner

---

## CLI Usage

```bash
# Test BTCUSD with optimal scalp timeframe (NEW - was m5)
node scripts/quick-backtest.mjs --compare-all --tf scalp -s BTCUSD

# Test Gold with scalp timeframe
node scripts/quick-backtest.mjs --compare-all --tf scalp -s XAUUSD.s

# Test Silver with scalp timeframe
node scripts/quick-backtest.mjs --compare-all --tf scalp -s XAGUSD.s

# Custom date range
node scripts/quick-backtest.mjs --compare-all --tf scalp -s BTCUSD --start 2026-01-22 --end 2026-02-11

# Quick single run
node scripts/quick-backtest.mjs --tf scalp -s XAUUSD.s
```

---

## Risk Management Guidelines

| Account Type | Max DD | Strategy | Profile |
|--------------|--------|----------|---------|
| Prop Firm Challenge | 3-5% | XAU: OB70\|RR3\|BE0.75R | `XAU_SAFE` |
| Funded Account | 8% | Symbol-specific optimal | `*_OPTIMAL` |
| Personal Account | 8-20% | NoFilter + high RR | Aggressive |

---

## Iteration History

### Jan 2026 - Round 1
- Tested confirmation types: NoConf, Close, Strong, Engulf
- Tested R:R variations: 1.5, 2.0, 2.5, 3.0
- Tested OB scores: 60, 65, 70, 75, 80
- Tested ATR multipliers: 0.8, 1.0, 1.2, 1.5
- Finding: NoConf dominated, optimal params vary by symbol

### Feb 2026 - Round 1 (20-day test, 124 variations)
- Tested all existing strategies on Jan 22 - Feb 11 data
- Finding: BTC on M5 only produced 1 OB trade (useless)
- Finding: Gold EVERY-OB NoFilter|RR2.5 = 83.1% WR, PF 6.44
- Finding: Silver TIERED 50@0.5R|30@1R|20@1.5R = 80.5% WR

### Feb 2026 - Round 2 (20-day test, 141 variations)
- Added 17 hybrid strategies: BE+higher RR, NoFilter+BE, ATR2.0+BE, Tiered+BE
- **BREAKTHROUGH**: BTC on Scalp (H1/M15/M1) = $2,071 vs $215 on M5
- ATR2.0-BE: RR3|BE0.75R = 83.8% WR on BTC
- Confirmed BE at 0.75R consistently outperforms 1.0R
- Updated all strategy profiles with new optimal configurations
