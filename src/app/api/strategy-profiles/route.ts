import { NextRequest, NextResponse } from 'next/server';
import {
  STRATEGY_PROFILES,
  SYMBOL_RECOMMENDED_PROFILES,
  SYMBOL_DEFAULTS,
  getProfilesByTier,
  getRecommendedProfile,
  validateProfile,
  getSymbolConfig,
  LiveStrategyConfig,
  DEFAULT_LIVE_CONFIG,
  StrategyProfile,
  RiskTier,
} from '@/lib/strategies/strategy-profiles';
import { tradingBot } from '@/services/bot';

/**
 * GET /api/strategy-profiles
 *
 * Get available strategy profiles and current configuration
 *
 * Query params:
 * - tier: Filter by risk tier ('aggressive' | 'balanced' | 'conservative')
 * - symbol: Get recommended profiles for a specific symbol
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const tier = searchParams.get('tier') as RiskTier | null;
    const symbol = searchParams.get('symbol');

    // Get current bot config
    const botStatus = tradingBot.getStatus();

    // Filter profiles if tier specified
    let profiles: StrategyProfile[];
    if (tier) {
      profiles = getProfilesByTier(tier);
    } else {
      profiles = Object.values(STRATEGY_PROFILES);
    }

    // Get symbol-specific recommendations
    let recommended: string[] = [];
    let symbolDefaults = null;
    if (symbol) {
      recommended = SYMBOL_RECOMMENDED_PROFILES[symbol] || [];
      symbolDefaults = SYMBOL_DEFAULTS[symbol] || null;
    }

    return NextResponse.json({
      profiles: profiles.map(p => ({
        id: Object.keys(STRATEGY_PROFILES).find(k => STRATEGY_PROFILES[k] === p),
        ...p,
      })),
      recommended,
      symbolDefaults,
      currentConfig: {
        strategyProfile: botStatus.config.strategyProfile || 'BALANCED_STRONG',
        liveTrading: botStatus.config.liveTrading ?? false,
        symbols: botStatus.config.symbols,
        useKillZones: botStatus.config.useKillZones ?? true,
        killZones: botStatus.config.killZones || ['LONDON_OPEN', 'NY_OPEN', 'LONDON_NY_OVERLAP'],
        riskReward: botStatus.config.riskReward ?? 2,
        minOBScore: botStatus.config.minOBScore ?? 70,
        confirmationType: botStatus.config.confirmationType ?? 'strong',
        maxDailyDrawdown: botStatus.config.maxDailyDrawdown ?? 6,
      },
      riskTiers: ['aggressive', 'balanced', 'conservative'],
      availableSymbols: ['XAUUSD.s', 'BTCUSD', 'XAGUSD.s'],
    });
  } catch (error) {
    console.error('Error fetching strategy profiles:', error);
    return NextResponse.json(
      { error: 'Failed to fetch strategy profiles' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/strategy-profiles
 *
 * Update strategy configuration
 *
 * Body:
 * - profileId: Strategy profile ID to use
 * - liveTrading: Whether to enable live trading (CAREFUL!)
 * - symbols: Array of symbols to trade with optional overrides
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      profileId,
      liveTrading,
      symbols,
      symbolOverrides,
    } = body;

    // Validate profile exists
    if (profileId && !STRATEGY_PROFILES[profileId]) {
      return NextResponse.json(
        { error: `Unknown profile: ${profileId}` },
        { status: 400 }
      );
    }

    const profile = profileId ? STRATEGY_PROFILES[profileId] : STRATEGY_PROFILES['BALANCED_STRONG'];

    // Validate profile configuration
    const validation = validateProfile(profile);
    if (!validation.valid) {
      return NextResponse.json(
        { error: 'Invalid profile configuration', details: validation.errors },
        { status: 400 }
      );
    }

    // Build new config
    const newConfig = {
      strategyProfile: profileId || 'BALANCED_STRONG',
      liveTrading: liveTrading ?? false,
      symbols: symbols || ['XAUUSD.s', 'BTCUSD', 'XAGUSD.s'],
      useKillZones: profile.useKillZones,
      killZones: profile.killZones,
      riskPercent: profile.riskPercent,
      riskReward: profile.riskReward,
      minOBScore: profile.minOBScore,
      confirmationType: profile.confirmationType,
      maxDailyDrawdown: profile.maxDailyDrawdown,
      maxOpenTrades: profile.maxConcurrentTrades,
      symbolSettings: symbols?.map((symbol: string) => ({
        symbol,
        enabled: true,
        ...(symbolOverrides?.[symbol] || SYMBOL_DEFAULTS[symbol] || {}),
      })),
    };

    // Update bot config
    tradingBot.updateConfig(newConfig);

    // Log the change for safety
    console.log('[Strategy Profiles] Configuration updated:', {
      profile: profileId,
      liveTrading: newConfig.liveTrading,
      symbols: newConfig.symbols,
    });

    // WARNING: If enabling live trading, log extra warning
    if (liveTrading) {
      console.warn('[Strategy Profiles] LIVE TRADING ENABLED - Real trades will be executed!');
    }

    return NextResponse.json({
      success: true,
      message: liveTrading
        ? 'Configuration updated - LIVE TRADING ENABLED'
        : 'Configuration updated - Paper mode active',
      config: newConfig,
      warning: liveTrading
        ? 'Live trading is enabled. Real trades will be executed with real money.'
        : null,
    });
  } catch (error) {
    console.error('Error updating strategy config:', error);
    return NextResponse.json(
      { error: 'Failed to update strategy configuration' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/strategy-profiles
 *
 * Quick toggle for live trading or specific symbol
 *
 * Body:
 * - action: 'enable_live' | 'disable_live' | 'enable_symbol' | 'disable_symbol'
 * - symbol: (required for symbol actions)
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, symbol } = body;

    const botStatus = tradingBot.getStatus();
    const currentConfig = botStatus.config;

    switch (action) {
      case 'enable_live':
        tradingBot.updateConfig({ liveTrading: true });
        console.warn('[Strategy Profiles] LIVE TRADING ENABLED via quick toggle');
        return NextResponse.json({
          success: true,
          message: 'Live trading ENABLED - Real trades will be executed!',
          liveTrading: true,
        });

      case 'disable_live':
        tradingBot.updateConfig({ liveTrading: false });
        console.log('[Strategy Profiles] Live trading disabled, paper mode active');
        return NextResponse.json({
          success: true,
          message: 'Live trading disabled - Paper mode active',
          liveTrading: false,
        });

      case 'enable_symbol':
        if (!symbol) {
          return NextResponse.json(
            { error: 'Symbol required for enable_symbol action' },
            { status: 400 }
          );
        }
        const enabledSymbols = [...new Set([...currentConfig.symbols, symbol])];
        tradingBot.updateConfig({ symbols: enabledSymbols });
        return NextResponse.json({
          success: true,
          message: `${symbol} enabled`,
          symbols: enabledSymbols,
        });

      case 'disable_symbol':
        if (!symbol) {
          return NextResponse.json(
            { error: 'Symbol required for disable_symbol action' },
            { status: 400 }
          );
        }
        const disabledSymbols = currentConfig.symbols.filter(s => s !== symbol);
        tradingBot.updateConfig({ symbols: disabledSymbols });
        return NextResponse.json({
          success: true,
          message: `${symbol} disabled`,
          symbols: disabledSymbols,
        });

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Error in quick toggle:', error);
    return NextResponse.json(
      { error: 'Failed to toggle setting' },
      { status: 500 }
    );
  }
}
