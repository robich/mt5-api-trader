# MT5 API Trader - Project Context

## Project Overview
Automated trading system using MetaAPI for MT5, implementing SMC (Smart Money Concepts) strategies including Order Blocks, FVG, Liquidity Sweeps, and BOS.

## Key Files

### Backtesting
- `scripts/quick-backtest.mjs` - Main CLI backtest tool with 141 strategy variations
- `scripts/cli-backtest.ts` - TypeScript backtest runner
- `.claude/backtest-insights.md` - **Detailed backtest results and optimization insights**

### Strategy Configuration
- `src/lib/strategies/strategy-profiles.ts` - Production strategy profiles (updated Feb 2026)
- `src/lib/types/index.ts` - Types including `TIERED_TP_PROFILES`

## Backtest Results Summary (Feb 2026)

### Best Performing Strategies (20-day test, 141 variations per symbol)

| Symbol | Strategy | Win% | PF | PnL | Max DD |
|--------|----------|------|-----|-----|--------|
| BTCUSD | EVERY-OB: ATR1.5\|RR2 (Scalp) | 70.9% | 3.35 | $2,071 | 7.6% |
| XAUUSD.s | EVERY-OB: NoFilter\|RR2.5 | 83.1% | 6.44 | $2,311 | 4.9% |
| XAGUSD.s | TIERED: 50@0.5R\|30@1R\|20@1.5R | 80.5% | 2.95 | $3,066 | 7.7% |

### Key Findings
- **All symbols use Scalp (H1/M15/M1)** - BTC switched from M5, 10x improvement
- **NoFilter OB (minOBScore=0)** with ATR filtering outperforms strict OB score
- **Breakeven at 0.75R** consistently better than 1.0R
- **ATR2.0** gives 83-89% WR but fewer trades (great for prop firms)

### Strategy Profiles
- **BTC_OPTIMAL**: ATR1.5|RR2 NoFilter on Scalp
- **BTC_HIGH_WR**: ATR2.0|RR3|BE0.75R (83.8% WR)
- **XAU_OPTIMAL**: NoFilter|RR2.5 on Scalp
- **XAU_SAFE**: OB70|RR3|BE0.75R (84.9% WR, 3.9% MaxDD)
- **XAG_OPTIMAL**: TIERED 50@0.5R|30@1R|20@1.5R on Scalp

## Running Backtests

```bash
# All symbols now use scalp timeframe
node scripts/quick-backtest.mjs --compare-all --tf scalp -s BTCUSD
node scripts/quick-backtest.mjs --compare-all --tf scalp -s XAUUSD.s
node scripts/quick-backtest.mjs --compare-all --tf scalp -s XAGUSD.s

# Custom date range
node scripts/quick-backtest.mjs --compare-all --tf scalp -s BTCUSD --start 2026-01-22 --end 2026-02-11
```

See `.claude/backtest-insights.md` for full analysis and iteration history.
