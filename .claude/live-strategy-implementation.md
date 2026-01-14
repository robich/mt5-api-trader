# Live Strategy Implementation

**Created:** 2026-01-13
**Based on:** backtest-insights.md (Nov 2025 - Jan 2026 optimization)

---

## Overview

This document describes the implementation of backtest-optimized strategies for live trading of XAUUSD.s, BTCUSD, and XAGUSD.s.

**IMPORTANT:** Live trading is DISABLED by default. The system operates in paper mode until explicitly enabled.

---

## New Files Created

### 1. Strategy Profiles (`src/lib/strategies/strategy-profiles.ts`)

Defines production-ready strategy configurations:

| Profile | Risk Tier | OB Score | Kill Zones | Max DD | Confirmation | R:R |
|---------|-----------|----------|------------|--------|--------------|-----|
| AGGRESSIVE_ENGULF | Aggressive | 70 | No | 8% | Engulfing | 2:1 |
| AGGRESSIVE_NOCONF | Aggressive | 70 | No | 8% | None | 2:1 |
| BALANCED_STRONG | Balanced | 70 | Yes | 6% | Strong | 2:1 |
| BALANCED_CLOSE | Balanced | 65 | Yes | 6% | Close | 2:1 |
| CONSERVATIVE_STRONG | Conservative | 70 | Yes | 5% | Strong | 2:1 |
| CONSERVATIVE_ENGULF | Conservative | 75 | Yes | 5% | Engulfing | 2:1 |
| BALANCED_25RR | Balanced | 70 | Yes | 6% | Strong | 2.5:1 |
| AGGRESSIVE_3RR | Aggressive | 65 | Yes | 8% | Engulfing | 3:1 |

### 2. Confirmation Analysis (`src/lib/analysis/confirmation.ts`)

Implements four confirmation candle types:

- **none**: Immediate entry on OB touch
- **close**: Candle closes in direction (30%+ body)
- **strong**: Strong directional candle (50%+ body)
- **engulf**: Engulfing pattern (best for BTCUSD)

### 3. Strategy Profiles API (`src/app/api/strategy-profiles/route.ts`)

REST API for managing strategy configurations:

```bash
# Get available profiles
GET /api/strategy-profiles

# Get profiles filtered by risk tier
GET /api/strategy-profiles?tier=balanced

# Get symbol-specific recommendations
GET /api/strategy-profiles?symbol=BTCUSD

# Update configuration
POST /api/strategy-profiles
{
  "profileId": "BALANCED_STRONG",
  "liveTrading": false,
  "symbols": ["XAUUSD.s", "BTCUSD"]
}

# Quick toggles
PUT /api/strategy-profiles
{ "action": "enable_live" }
{ "action": "disable_live" }
{ "action": "enable_symbol", "symbol": "XAGUSD.s" }
```

---

## Symbol-Specific Recommendations

Based on backtest performance:

### BTCUSD (Best Performer)
- **Win Rate:** 81-82%
- **Profit Factor:** 3.50-3.60
- **Recommended Profile:** AGGRESSIVE_ENGULF
- **Best Confirmation:** Engulfing pattern

### XAUUSD.s (Gold)
- **Win Rate:** 73-75%
- **Profit Factor:** 2.60-3.60
- **Recommended Profile:** BALANCED_STRONG or AGGRESSIVE_ENGULF
- **Best Confirmation:** Strong or Engulfing

### XAGUSD.s (Silver)
- **Win Rate:** 76-77%
- **Profit Factor:** 2.70
- **Recommended Profile:** BALANCED_STRONG or CONSERVATIVE_STRONG
- **Best Confirmation:** Strong
- **Note:** Lower trade volume

---

## Usage Guide

### 1. Select a Strategy Profile

```typescript
import { STRATEGY_PROFILES, getSymbolConfig } from '@/lib/strategies';

// Get balanced profile
const profile = STRATEGY_PROFILES['BALANCED_STRONG'];

// Get effective config for a symbol with overrides
const symbolConfig = getSymbolConfig(liveConfig, 'BTCUSD');
```

### 2. Configure via API

```bash
# Set conservative profile for prop firm trading
curl -X POST /api/strategy-profiles \
  -H "Content-Type: application/json" \
  -d '{
    "profileId": "CONSERVATIVE_STRONG",
    "liveTrading": false,
    "symbols": ["XAUUSD.s", "XAGUSD.s"]
  }'
```

### 3. Enable Live Trading (CAREFUL!)

```bash
# Enable live trading (real money!)
curl -X PUT /api/strategy-profiles \
  -H "Content-Type: application/json" \
  -d '{ "action": "enable_live" }'
```

---

## Risk Management Features

### Daily Drawdown Limit

Each symbol tracks daily drawdown independently:
- Trading is locked when limit is reached
- Resets at start of each day (UTC)
- Configurable per profile (5-8%)

### Kill Zone Filter

When enabled, trades only execute during:
- **London Open:** 07:00-10:00 UTC
- **NY Open:** 12:00-15:00 UTC
- **London/NY Overlap:** 12:00-16:00 UTC

### Confirmation Candles

Higher quality entries by waiting for price confirmation:
- Reduces false entries
- Best results with engulfing pattern on BTCUSD

---

## Default Configuration

```typescript
{
  strategyProfile: 'BALANCED_STRONG',
  liveTrading: false,  // Paper mode!
  symbols: ['XAUUSD.s', 'BTCUSD', 'XAGUSD.s'],
  useKillZones: true,
  killZones: ['LONDON_OPEN', 'NY_OPEN', 'LONDON_NY_OVERLAP'],
  riskReward: 2,
  minOBScore: 70,
  confirmationType: 'strong',
  maxDailyDrawdown: 6,
  riskPercent: 1.5,
  maxConcurrentTrades: 2,
}
```

---

## Profile Selection Guide

| Use Case | Recommended Profile |
|----------|---------------------|
| Prop Firm Challenge | CONSERVATIVE_STRONG |
| Funded Account | BALANCED_STRONG |
| Personal Account (aggressive) | AGGRESSIVE_ENGULF |
| BTCUSD focused | AGGRESSIVE_ENGULF or AGGRESSIVE_3RR |
| Gold/Silver focused | BALANCED_STRONG |
| Extended targets | BALANCED_25RR or AGGRESSIVE_3RR |

---

## Safety Features

1. **Live trading disabled by default** - Must be explicitly enabled
2. **Daily drawdown limits** - Automatic trading lockout
3. **Kill zone filtering** - Trade only during optimal hours
4. **Confirmation candles** - Reduce premature entries
5. **Symbol-specific settings** - Different risk per asset

---

## Files Modified

- `src/lib/types/index.ts` - Added new config types
- `src/lib/risk/trade-manager.ts` - Daily DD tracking, kill zone checks
- `src/lib/strategies/index.ts` - Export strategy profiles
- `src/lib/analysis/index.ts` - Export confirmation module
