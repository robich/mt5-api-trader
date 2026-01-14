# MT5 API Trader

A Smart Money Concepts (SMC) trading bot with backtesting capabilities for MetaTrader 5 via MetaAPI.

## Features

- Multi-timeframe SMC analysis (HTF, MTF, LTF)
- Order Block detection and trading
- Fair Value Gap (FVG) identification
- Liquidity sweep detection
- Kill zone session filtering
- CLI backtesting with parameter optimization

## Getting Started

### Prerequisites

- Node.js 18+
- MetaAPI account and credentials

### Installation

```bash
npm install
```

### Environment Setup

Create a `.env` file with your MetaAPI credentials:

```env
META_API_TOKEN=your_metaapi_token
META_API_ACCOUNT_ID=your_account_id
```

### Run Development Server

```bash
npm run dev
```

Open [http://localhost:3001](http://localhost:3001) to view the dashboard.

## CLI Backtesting

Run backtests from the command line for efficient strategy testing and optimization.

### Quick Start

```bash
# Basic backtest with default settings
npm run backtest -- --symbol XAUUSD.s

# Compare all strategy variations
npm run backtest:compare -- --symbol XAUUSD.s

# Run parameter optimization
npm run backtest:optimize -- --symbol XAUUSD.s
```

### CLI Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--symbol` | `-s` | Trading symbol | `XAUUSD.s` |
| `--strategy` | | Strategy type | `ORDER_BLOCK` |
| `--start` | | Start date (YYYY-MM-DD) | 3 months ago |
| `--end` | | End date (YYYY-MM-DD) | Today |
| `--balance` | `-b` | Initial balance | `10000` |
| `--risk` | `-r` | Risk % per trade | `2` |
| `--optimize` | `-o` | Run parameter optimization | `false` |
| `--compare-all` | `-c` | Compare all variations | `false` |
| `--verbose` | `-v` | Show detailed output | `false` |
| `--help` | `-h` | Show help | |

### Available Strategies

- `ORDER_BLOCK` - Order Block + FVG confluence strategy
- `LIQUIDITY_SWEEP` - Liquidity sweep reversal strategy
- `BOS` - Break of Structure strategy
- `FBO_CLASSIC` - Failed Breakout classic pattern
- `FBO_SWEEP` - Failed Breakout with liquidity sweep
- `FBO_STRUCTURE` - Failed Breakout with structure break

### Examples

```bash
# Backtest ORDER_BLOCK strategy on Gold
npm run backtest -- --symbol XAUUSD.s --strategy ORDER_BLOCK

# Backtest with custom date range
npm run backtest -- -s BTCUSD --start 2024-06-01 --end 2024-12-01

# Compare all variations with verbose output
npm run backtest:compare -- -s XAUUSD.s -v

# Custom balance and risk
npm run backtest -- -s XAUUSD.s -b 50000 -r 1
```

### Strategy Variations Tested

When using `--compare-all` or `--optimize`, the following variations are tested:

| Variation | Description |
|-----------|-------------|
| OTE On/Off | Impact of Optimal Trade Entry filter |
| Fixed 2:1/3:1 RR | Fixed risk-reward ratios |
| ATR Trailing | Dynamic ATR-based trailing stop |
| Kill Zones Only | London + NY sessions only |
| All Sessions | No session filtering |
| 6%/4% Daily DD | Max daily drawdown limits |

### Sample Output

```
============================================================
BACKTEST COMPARISON RESULTS
============================================================
Strategy                        Trades  Win%    PF    PnL $   MaxDD%
--------------------------------------------------------------------
Relaxed >=70 | OTE On | Fixed RR    45   73.1  2.15   +2450     8.2
OTE On | Fixed 2:1 RR               52   68.5  1.89   +1850    10.1
OTE Off | Fixed 2:1 RR              78   41.4  0.95    -320    15.3
============================================================

**************************************************
  WINNING STRATEGY: "Relaxed >=70 | OTE On | Fixed RR"
  Win Rate: 73.1% | Profit Factor: 2.15 | PnL: $2450
**************************************************
```

### Key Findings from Backtesting

Based on extensive backtesting, these parameters perform best:

| Parameter | Optimal Value |
|-----------|---------------|
| OTE Filter | **Enabled** (nearly doubles win rate) |
| Risk:Reward | **Fixed 2:1** (outperforms trailing) |
| Min OB Score | **70+** for relaxed entry |
| Kill Zones | **Enabled** (London + NY) |
| Max Daily DD | **6%** |
| Risk per Trade | **2%** |

### Trading Sessions (Kill Zones)

| Session | Time (UTC) |
|---------|------------|
| London Open | 07:00 - 10:00 |
| NY AM | 12:00 - 15:00 |
| NY PM | 18:00 - 20:00 |
| London/NY Overlap | 12:00 - 16:00 |

## Project Structure

```
mt5-api-trader/
├── scripts/
│   ├── quick-backtest.mjs    # Native JS CLI backtest
│   └── cli-backtest.ts       # TypeScript CLI backtest
├── src/
│   ├── app/                  # Next.js pages
│   │   └── api/              # API routes
│   │       ├── backtest/     # Backtest endpoints
│   │       ├── signals/      # Signal endpoints
│   │       └── trades/       # Trade endpoints
│   ├── lib/
│   │   ├── analysis/         # SMC analysis modules
│   │   │   ├── order-blocks.ts
│   │   │   ├── fvg.ts
│   │   │   ├── liquidity.ts
│   │   │   ├── kill-zones.ts
│   │   │   └── market-structure.ts
│   │   ├── backtest/         # Backtest engine
│   │   ├── strategies/       # Trading strategies
│   │   ├── risk/             # Position sizing
│   │   └── metaapi/          # MetaAPI client
│   └── components/           # React components
└── prisma/                   # Database schema
```

## NPM Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run backtest` | Run CLI backtest |
| `npm run backtest:compare` | Compare all variations |
| `npm run backtest:optimize` | Run optimization |
| `npm run backtest:ts` | TypeScript backtest |

## License

Private project.
