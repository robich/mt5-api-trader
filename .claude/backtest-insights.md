# Backtest Optimization Insights

**Last Updated:** 2026-01-13
**Test Period:** November 13, 2025 - January 13, 2026 (2 months)

---

## Executive Summary

After 5 iterations of optimization, the Order Block strategy with confirmation candle filtering produces the best results. BTCUSD significantly outperforms other symbols.

---

## Best Strategies by Use Case

### Aggressive Trading (Higher Risk/Reward)
```
Strategy: OB70|All|DD8%|Engulf
- OB Score: 70+
- Sessions: All (no kill zone filter)
- Max Daily DD: 8%
- Confirmation: Engulfing candle pattern
- R:R: 2:1
```

### Balanced Trading (Good Risk/Reward)
```
Strategy: OB65|KZ|DD6%|Close
- OB Score: 65+
- Sessions: Kill Zones only (London, NY AM, NY PM)
- Max Daily DD: 6%
- Confirmation: Simple close in direction
- R:R: 2:1
```

### Conservative Trading (Prop Firm Challenges)
```
Strategy: OB70|KZ|DD5%|Strong
- OB Score: 70+
- Sessions: Kill Zones only
- Max Daily DD: 5%
- Confirmation: Strong candle (50%+ body)
- R:R: 2:1
```

---

## Symbol Performance Summary

### BTCUSD (Bitcoin) - BEST PERFORMER
| Metric | Value |
|--------|-------|
| Win Rate | 81-82% |
| Profit Factor | 3.50-3.60 |
| Max Drawdown | 9-12% |
| Recommended Strategy | OB70\|All\|DD8%\|Engulf |

### XAUUSD.s (Gold)
| Metric | Value |
|--------|-------|
| Win Rate | 73-75% |
| Profit Factor | 2.60-3.60 |
| Max Drawdown | 15-32% |
| Recommended Strategy | OB70\|All\|DD8%\|Engulf or OB70\|KZ\|DD6%\|Strong |

### XAGUSD.s (Silver)
| Metric | Value |
|--------|-------|
| Win Rate | 76-77% |
| Profit Factor | 2.70 |
| Max Drawdown | 13-17% |
| Recommended Strategy | OB70\|All\|DD8%\|Strong |
| Note | Lower trade volume than Gold/BTC |

---

## Monthly Performance (XAUUSD.s)

### November 2025
- **Performance:** Excellent
- **Best PF:** 3.63 (OB70|All|DD8%|Engulf)
- **Trades:** 178
- **Win Rate:** 75%
- **Max DD:** 14.6%
- **Notes:** Best month, favorable market conditions

### December 2025
- **Performance:** Good
- **Best PF:** 2.80 (BALANCED: OB65|KZ|DD6%|Close)
- **Trades:** 301 (Aggressive) / 116 (Balanced)
- **Win Rate:** 73-75%
- **Max DD:** 6-23%
- **Notes:** Higher activity, conservative strategies performed well

### January 2026
- **Performance:** Limited data (holiday period)
- **Notes:** Only 12 days, insufficient for analysis

---

## Confirmation Candle Types

### 1. No Confirmation (NoConf)
- Enter immediately when OB is touched
- Highest trade frequency
- Works well with high OB scores (70+)

### 2. Close Confirmation
- Wait for candle to close in trade direction
- Body must be 30%+ of range
- Good balance of frequency and quality

### 3. Strong Confirmation
- Wait for strong candle (50%+ body of range)
- Fewer trades, better quality
- Best for volatile markets

### 4. Engulfing Confirmation
- Wait for engulfing pattern
- Current candle body engulfs previous
- Best overall performance on BTCUSD

---

## Key Code Changes Made

### 1. Order Block Detection Fix
- File: `scripts/quick-backtest.mjs`
- Fixed `findValidOrderBlock()` method - was using incorrect distance calculation
- Added configurable ATR multiplier (`atrMult` parameter)

### 2. Confirmation Candle System
- Added `requireConfirmation` and `confirmationType` config options
- Types: 'close', 'strong', 'engulf'
- Pending signal system with 4-hour expiry

### 3. Entry Quality Relaxation
- Changed score threshold from 70 to 60 for simple touch entries
- Scores 50-59 now allow entry with directional candle OR rejection wick

### 4. Strategy Variations
Located in `VARIATIONS` array in `scripts/quick-backtest.mjs`

---

## Risk Management Guidelines

| Account Type | Recommended DD Limit | Kill Zones | Min OB Score |
|--------------|---------------------|------------|--------------|
| Prop Firm Challenge | 5% | Yes | 70+ |
| Funded Account | 6-8% | Optional | 65+ |
| Personal Account | 8-10% | No | 60+ |

---

## CLI Commands

```bash
# Run all strategy variations
node scripts/quick-backtest.mjs --compare-all --symbol XAUUSD.s

# Custom date range
node scripts/quick-backtest.mjs --compare-all --symbol BTCUSD --start 2025-11-01 --end 2025-12-31

# Single symbol quick test
node scripts/quick-backtest.mjs --symbol XAUUSD.s
```

---

## Future Optimization Ideas

1. **Test additional symbols:** EURUSD, GBPUSD, US30
2. **Time-based filters:** Avoid first/last hour of sessions
3. **Volatility filter:** ATR-based position sizing
4. **Multi-timeframe confirmation:** H4 trend + H1 entry
5. **Seasonal analysis:** Compare performance by month/quarter
