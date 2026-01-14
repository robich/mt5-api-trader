# MT5 API Trader - Project Context

## Project Overview
Automated trading system using MetaAPI for MT5, implementing SMC (Smart Money Concepts) strategies including Order Blocks, FVG, Liquidity Sweeps, and BOS.

## Key Files

### Backtesting
- `scripts/quick-backtest.mjs` - Main CLI backtest tool with strategy variations
- `scripts/cli-backtest.ts` - TypeScript backtest runner
- `.claude/backtest-insights.md` - **Detailed backtest results and optimization insights**

### Strategy Configuration
The `VARIATIONS` array in `quick-backtest.mjs` contains all tested strategy configurations.

## Backtest Results Summary (Jan 2026)

### Best Performing Strategies

| Symbol | Strategy | Win% | PF | Max DD |
|--------|----------|------|-----|--------|
| BTCUSD | OB70\|All\|DD8%\|Engulf | 81.6% | 3.52 | 11.6% |
| XAUUSD.s | OB70\|All\|DD8%\|Engulf | 73.8% | 2.65 | 21.6% |
| XAGUSD.s | OB70\|All\|DD8%\|Strong | 76.6% | 2.70 | 16.6% |

### Strategy Parameters Explained
- **OB70**: Order Block minimum score of 70
- **All/KZ**: All sessions vs Kill Zones only (London 7-10, NY AM 12-15, NY PM 19-21 UTC)
- **DD6%/DD8%**: Maximum daily drawdown limit
- **Engulf/Strong/Close**: Confirmation candle type

### Recommended Settings by Risk Profile
- **Aggressive**: `OB70|All|DD8%|Engulf` - Higher profit, ~20-30% DD
- **Balanced**: `OB65|KZ|DD6%|Close` - Good profit, ~10-15% DD
- **Conservative**: `OB70|KZ|DD5%|Strong` - Lower profit, ~5-10% DD

## Running Backtests

```bash
# Compare all strategies
node scripts/quick-backtest.mjs --compare-all --symbol XAUUSD.s

# Custom date range
node scripts/quick-backtest.mjs --compare-all --symbol BTCUSD --start 2025-11-01 --end 2025-12-31
```

## Important Notes
- BTCUSD significantly outperforms other symbols (81%+ win rate)
- Kill Zone filter reduces drawdown but also reduces trade count
- Engulfing confirmation works best for aggressive strategies
- November showed best performance; December was more volatile
- January has limited data due to holidays

See `.claude/backtest-insights.md` for full analysis and monthly breakdowns.
