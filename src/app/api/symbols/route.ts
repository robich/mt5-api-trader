import { NextRequest, NextResponse } from 'next/server';
import { metaApiClient } from '@/lib/metaapi/client';

// Fallback symbols when MetaAPI connection is not available
// Using .s suffix variants first (swap-free accounts)
const FALLBACK_SYMBOLS = [
  'XAUUSD.s', 'XAUUSD', 'XAUUSDm',
  'XAGUSD.s', 'XAGUSD', 'XAGUSDm',
  'BTCUSD.s', 'BTCUSD', 'BTCUSDm',
  'EURUSD.s', 'EURUSD', 'EURUSDm',
  'GBPUSD.s', 'GBPUSD', 'GBPUSDm',
  'USDJPY.s', 'USDJPY', 'USDJPYm',
  'ETHUSD.s', 'ETHUSD', 'ETHUSDm',
];

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q');

    let symbols: string[];

    // Use fallback symbols - streaming connection uses subscriptions which are limited
    // getAvailableSymbols() requires streaming which causes TooManyRequestsError
    // when subscription quota (25) is exceeded
    symbols = FALLBACK_SYMBOLS;

    if (query) {
      const lowerQuery = query.toLowerCase();
      symbols = symbols.filter(s => s.toLowerCase().includes(lowerQuery));
    }

    // Filter for common tradeable symbols (gold, silver, forex, crypto)
    const relevantSymbols = symbols.filter((s) => {
      const upper = s.toUpperCase();
      return (
        upper.includes('XAU') ||
        upper.includes('GOLD') ||
        upper.includes('XAG') ||
        upper.includes('SILVER') ||
        upper.includes('BTC') ||
        upper.includes('ETH') ||
        upper.includes('USD') ||
        upper.includes('EUR') ||
        upper.includes('GBP') ||
        upper.includes('JPY')
      );
    });

    // Prioritize default symbols (XAUUSD.s, BTCUSD.s, XAGUSD.s) at the top
    const DEFAULT_SYMBOLS = ['XAUUSD.s', 'BTCUSD.s', 'XAGUSD.s'];
    const sortedSymbols = relevantSymbols.sort((a, b) => {
      const aUpper = a.toUpperCase();
      const bUpper = b.toUpperCase();
      const aIsDefault = DEFAULT_SYMBOLS.some(d => aUpper.includes(d));
      const bIsDefault = DEFAULT_SYMBOLS.some(d => bUpper.includes(d));
      if (aIsDefault && !bIsDefault) return -1;
      if (!aIsDefault && bIsDefault) return 1;
      if (aIsDefault && bIsDefault) {
        const aIndex = DEFAULT_SYMBOLS.findIndex(d => aUpper.includes(d));
        const bIndex = DEFAULT_SYMBOLS.findIndex(d => bUpper.includes(d));
        return aIndex - bIndex;
      }
      return a.localeCompare(b);
    });

    return NextResponse.json({
      symbols: sortedSymbols.slice(0, 50),
      total: symbols.length,
    });
  } catch (error) {
    console.error('Symbols API error:', error);
    return NextResponse.json(
      { error: `Failed to fetch symbols: ${error}` },
      { status: 500 }
    );
  }
}
