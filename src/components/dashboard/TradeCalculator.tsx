'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  calculatePositionSize,
  calculateRiskReward,
  calculatePotentialPnL,
} from '@/lib/risk/position-sizing';
import { SymbolInfo } from '@/lib/types';
import { Calculator, TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';
import InteractiveTradeChart from './InteractiveTradeChart';

// Default symbol specifications
const DEFAULT_SYMBOL_INFO: Record<string, Partial<SymbolInfo>> = {
  // Metals
  'XAUUSD.s': {
    pipSize: 0.1,
    contractSize: 100,
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    tickSize: 0.01,
    tickValue: 1,
    digits: 2,
  },
  'XAGUSD.s': {
    pipSize: 0.01,
    contractSize: 5000,
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    tickSize: 0.001,
    tickValue: 1,
    digits: 3,
  },
  // Crypto
  BTCUSD: {
    pipSize: 1,
    contractSize: 1,
    minVolume: 0.01,
    maxVolume: 10,
    volumeStep: 0.01,
    tickSize: 0.01,
    tickValue: 1,
    digits: 2,
  },
  ETHUSD: {
    pipSize: 1,
    contractSize: 1,
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    tickSize: 0.1,
    tickValue: 1,
    digits: 2,
  },
  // Indices
  DAX40: {
    pipSize: 1,
    contractSize: 1,
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    tickSize: 0.1,
    tickValue: 1,
    digits: 1,
  },
  US30: {
    pipSize: 1,
    contractSize: 1,
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    tickSize: 0.01,
    tickValue: 1,
    digits: 2,
  },
  US500: {
    pipSize: 1,
    contractSize: 1,
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    tickSize: 0.01,
    tickValue: 1,
    digits: 2,
  },
  NAS100: {
    pipSize: 1,
    contractSize: 1,
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    tickSize: 0.01,
    tickValue: 1,
    digits: 2,
  },
  UK100: {
    pipSize: 1,
    contractSize: 1,
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    tickSize: 0.01,
    tickValue: 1,
    digits: 2,
  },
  // Energy
  USOIL: {
    pipSize: 0.01,
    contractSize: 1000,
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    tickSize: 0.01,
    tickValue: 10,
    digits: 2,
  },
  UKOIL: {
    pipSize: 0.01,
    contractSize: 1000,
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    tickSize: 0.01,
    tickValue: 10,
    digits: 2,
  },
  // Forex
  EURUSD: {
    pipSize: 0.0001,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    tickSize: 0.00001,
    tickValue: 1,
    digits: 5,
  },
  GBPUSD: {
    pipSize: 0.0001,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    tickSize: 0.00001,
    tickValue: 1,
    digits: 5,
  },
  USDJPY: {
    pipSize: 0.01,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    tickSize: 0.001,
    tickValue: 1,
    digits: 3,
  },
  AUDUSD: {
    pipSize: 0.0001,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    tickSize: 0.00001,
    tickValue: 1,
    digits: 5,
  },
  USDCHF: {
    pipSize: 0.0001,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    tickSize: 0.00001,
    tickValue: 1,
    digits: 5,
  },
  EURGBP: {
    pipSize: 0.0001,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    tickSize: 0.00001,
    tickValue: 1,
    digits: 5,
  },
  NZDUSD: {
    pipSize: 0.0001,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    tickSize: 0.00001,
    tickValue: 1,
    digits: 5,
  },
  USDCAD: {
    pipSize: 0.0001,
    contractSize: 100000,
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    tickSize: 0.00001,
    tickValue: 1,
    digits: 5,
  },
};

interface AccountInfo {
  balance: number;
  equity: number;
  leverage: number;
  currency: string;
  freeMargin: number;
}

export default function TradeCalculator() {
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // Form inputs
  const [symbol, setSymbol] = useState('XAUUSD.s');
  const [direction, setDirection] = useState<'BUY' | 'SELL'>('BUY');
  const [lotSize, setLotSize] = useState('0.01');
  const [riskMode, setRiskMode] = useState<'percent' | 'amount'>('percent');
  const [riskPercent, setRiskPercent] = useState(1); // Risk percentage slider value
  const [riskAmount, setRiskAmount] = useState(''); // Risk amount in dollars
  const [entryPrice, setEntryPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [customLeverage, setCustomLeverage] = useState('1000');
  const [customBalance, setCustomBalance] = useState('');
  const [currentMarketPrice, setCurrentMarketPrice] = useState<number | null>(null);

  // Multiple TP levels
  const [useMultipleTPs, setUseMultipleTPs] = useState(false);
  const [tp1Price, setTp1Price] = useState('');
  const [tp2Price, setTp2Price] = useState('');
  const [tp3Price, setTp3Price] = useState('');
  const [tp1Allocation, setTp1Allocation] = useState('30');
  const [tp2Allocation, setTp2Allocation] = useState('30');
  const [tp3Allocation, setTp3Allocation] = useState('20');

  // Fetch account info
  useEffect(() => {
    const fetchAccountInfo = async () => {
      try {
        const response = await fetch('/api/account');
        if (response.ok) {
          const data = await response.json();
          setAccountInfo(data);
        }
      } catch (error) {
        console.error('Failed to fetch account info:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAccountInfo();
    const interval = setInterval(fetchAccountInfo, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  // Fetch current market price
  useEffect(() => {
    const fetchMarketPrice = async () => {
      try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setMinutes(startDate.getMinutes() - 5); // Last 5 minutes

        const params = new URLSearchParams({
          symbol,
          timeframe: 'M1',
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        });

        const response = await fetch(`/api/candles?${params.toString()}`);
        if (response.ok) {
          const data = await response.json();
          if (data.candles && data.candles.length > 0) {
            // Get the latest candle's close price
            const latestCandle = data.candles[data.candles.length - 1];
            const price = latestCandle.close;
            setCurrentMarketPrice(price);

            // Auto-populate entry price if it's empty on initial load
            setEntryPrice((prevEntry) => {
              if (!prevEntry || prevEntry === '') {
                const digits = symbolInfo?.digits || 2;
                return price.toFixed(digits);
              }
              return prevEntry;
            });
          }
        }
      } catch (error) {
        console.error('Failed to fetch market price:', error);
      }
    };

    fetchMarketPrice();
    const interval = setInterval(fetchMarketPrice, 5000); // Refresh every 5s
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]); // Re-fetch when symbol changes

  // Get symbol info
  const symbolInfo = useMemo(() => {
    const baseInfo = DEFAULT_SYMBOL_INFO[symbol];
    if (!baseInfo) return null;

    return {
      symbol,
      description: symbol,
      digits: baseInfo.digits || 2,
      pipSize: baseInfo.pipSize || 0.01,
      contractSize: baseInfo.contractSize || 100000,
      minVolume: baseInfo.minVolume || 0.01,
      maxVolume: baseInfo.maxVolume || 100,
      volumeStep: baseInfo.volumeStep || 0.01,
      tickSize: baseInfo.tickSize || 0.01,
      tickValue: baseInfo.tickValue || 1,
    } as SymbolInfo;
  }, [symbol]);

  // Calculate all metrics
  const calculations = useMemo(() => {
    if (!symbolInfo) return null;

    const lots = parseFloat(lotSize) || 0;
    const entry = parseFloat(entryPrice) || 0;
    const sl = parseFloat(stopLoss) || 0;
    const tp = parseFloat(takeProfit) || 0;
    const leverage = parseFloat(customLeverage) || accountInfo?.leverage || 1000;
    const balance = parseFloat(customBalance) || accountInfo?.balance || 10000;

    if (lots <= 0 || entry <= 0) return null;

    // Calculate pip value per lot in USD
    const pipValuePerLot = symbol.includes('JPY')
      ? (symbolInfo.contractSize * symbolInfo.pipSize) / entry
      : symbolInfo.contractSize * symbolInfo.pipSize;

    // Calculate position value
    const positionValue = lots * symbolInfo.contractSize * entry;
    const requiredMargin = positionValue / leverage;

    // Calculate stop loss metrics
    let slPips = 0;
    let slAmount = 0;
    let slPercentage = 0;

    if (sl > 0) {
      slPips = Math.abs(entry - sl) / symbolInfo.pipSize;
      const slResult = calculatePotentialPnL(
        lots,
        entry,
        sl,
        direction,
        symbolInfo
      );
      slAmount = Math.abs(slResult.pnl);
      slPercentage = (slAmount / balance) * 100;
    }

    // Calculate take profit metrics (multiple TPs if enabled)
    let tpPips = 0;
    let tpAmount = 0;
    let tpPercentage = 0;
    let rrRatio = 0;
    const tpLevels: Array<{ price: number; allocation: number; pips: number; amount: number; rr: number }> = [];

    if (useMultipleTPs) {
      // Multiple TP levels
      const tps = [
        { price: tp1Price, allocation: tp1Allocation },
        { price: tp2Price, allocation: tp2Allocation },
        { price: tp3Price, allocation: tp3Allocation },
      ];

      let totalAmount = 0;
      let totalAllocation = 0;

      for (const tp of tps) {
        if (!tp.price || tp.price.trim() === '') continue;

        const tpPriceNum = parseFloat(tp.price);
        const allocation = parseFloat(tp.allocation) || 0;

        if (isNaN(tpPriceNum) || tpPriceNum <= 0 || allocation <= 0) continue;

        const tpLotSize = (lots * allocation) / 100;
        const tpPipsCalc = Math.abs(tpPriceNum - entry) / symbolInfo.pipSize;
        const tpResult = calculatePotentialPnL(
          tpLotSize,
          entry,
          tpPriceNum,
          direction,
          symbolInfo
        );
        const tpRR = sl > 0 ? calculateRiskReward(direction, entry, sl, tpPriceNum) : 0;

        tpLevels.push({
          price: tpPriceNum,
          allocation: allocation,
          pips: tpPipsCalc,
          amount: Math.abs(tpResult.pnl),
          rr: tpRR,
        });

        totalAmount += Math.abs(tpResult.pnl);
        totalAllocation += allocation;
      }

      tpAmount = totalAmount;
      tpPercentage = (tpAmount / balance) * 100;
      // Weighted average R:R
      if (totalAllocation > 0 && sl > 0) {
        rrRatio = tpLevels.reduce((sum, tp) => sum + (tp.rr * tp.allocation), 0) / totalAllocation;
      }
    } else if (tp > 0) {
      // Single TP
      tpPips = Math.abs(tp - entry) / symbolInfo.pipSize;
      const tpResult = calculatePotentialPnL(
        lots,
        entry,
        tp,
        direction,
        symbolInfo
      );
      tpAmount = Math.abs(tpResult.pnl);
      tpPercentage = (tpAmount / balance) * 100;

      if (sl > 0) {
        rrRatio = calculateRiskReward(direction, entry, sl, tp);
      }
    }

    return {
      positionValue,
      requiredMargin,
      marginPercentage: (requiredMargin / balance) * 100,
      pipValuePerLot,
      slPips,
      slAmount,
      slPercentage,
      tpPips,
      tpAmount,
      tpPercentage,
      rrRatio,
      leverage,
      tpLevels: tpLevels.length > 0 ? tpLevels : undefined,
    };
  }, [
    symbolInfo,
    lotSize,
    entryPrice,
    stopLoss,
    takeProfit,
    direction,
    customLeverage,
    accountInfo,
    customBalance,
    useMultipleTPs,
    tp1Price,
    tp2Price,
    tp3Price,
    tp1Allocation,
    tp2Allocation,
    tp3Allocation,
  ]);

  // Auto-calculate lot size based on risk percentage
  const handleCalculateByRiskPercent = useCallback((riskPct: number) => {
    if (!symbolInfo || !entryPrice || !stopLoss) return;

    const entry = parseFloat(entryPrice);
    const sl = parseFloat(stopLoss);
    const balance = parseFloat(customBalance) || accountInfo?.balance || 10000;

    if (entry <= 0 || sl <= 0) return;

    const result = calculatePositionSize(
      balance,
      riskPct,
      entry,
      sl,
      symbolInfo
    );

    setLotSize(result.lotSize.toFixed(2));
  }, [symbolInfo, accountInfo, customBalance, entryPrice, stopLoss]);

  // Auto-calculate lot size based on risk amount in dollars
  const handleCalculateByRiskAmount = useCallback((riskAmt: number) => {
    if (!symbolInfo || !entryPrice || !stopLoss) return;

    const entry = parseFloat(entryPrice);
    const sl = parseFloat(stopLoss);
    const balance = parseFloat(customBalance) || accountInfo?.balance || 10000;

    if (entry <= 0 || sl <= 0 || riskAmt <= 0) return;

    // Convert dollar amount to percentage and reuse calculatePositionSize
    const riskPct = (riskAmt / balance) * 100;
    const result = calculatePositionSize(balance, riskPct, entry, sl, symbolInfo);

    setLotSize(result.lotSize.toFixed(2));
  }, [symbolInfo, entryPrice, stopLoss, customBalance, accountInfo]);

  // Auto-update lot size when risk changes
  useEffect(() => {
    if (riskMode === 'percent' && riskPercent > 0) {
      handleCalculateByRiskPercent(riskPercent);
    } else if (riskMode === 'amount' && riskAmount) {
      const amount = parseFloat(riskAmount);
      if (amount > 0) {
        handleCalculateByRiskAmount(amount);
      }
    }
  }, [riskMode, riskPercent, riskAmount, handleCalculateByRiskPercent, handleCalculateByRiskAmount]);

  // Handle price changes from the interactive chart
  const handleChartPriceChange = (type: 'entry' | 'sl' | 'tp', price: number) => {
    const digits = symbolInfo?.digits || 2;
    const formattedPrice = price.toFixed(digits);

    switch (type) {
      case 'entry':
        setEntryPrice(formattedPrice);
        break;
      case 'sl':
        setStopLoss(formattedPrice);
        break;
      case 'tp':
        setTakeProfit(formattedPrice);
        break;
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">Loading account information...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Account Info Banner */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="customBalance" className="text-sm text-muted-foreground">
                Balance
              </Label>
              <Input
                id="customBalance"
                type="number"
                step="100"
                value={customBalance}
                onChange={(e) => setCustomBalance(e.target.value)}
                placeholder={accountInfo?.balance != null ? accountInfo.balance.toFixed(2) : '10000'}
                className="mt-1 font-semibold"
              />
            </div>
            {accountInfo && (
              <>
                <div>
                  <p className="text-sm text-muted-foreground">Equity</p>
                  <p className="text-lg font-semibold mt-1">
                    ${(accountInfo.equity ?? 0).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Free Margin</p>
                  <p className="text-lg font-semibold mt-1">
                    ${(accountInfo.freeMargin ?? 0).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Account Leverage</p>
                  <p className="text-lg font-semibold mt-1">1:{accountInfo.leverage ?? 100}</p>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Interactive Chart with M1 Candles */}
      <Card>
        <CardHeader>
          <CardTitle>Live Market Price</CardTitle>
        </CardHeader>
        <CardContent>
          <InteractiveTradeChart
            symbol={symbol}
            entryPrice={parseFloat(entryPrice) || null}
            stopLoss={parseFloat(stopLoss) || null}
            takeProfit={parseFloat(takeProfit) || null}
            direction={direction}
            onPriceChange={handleChartPriceChange}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Input Form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Trade Parameters
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Symbol Selection */}
            <div className="space-y-2">
              <Label htmlFor="symbol">Symbol</Label>
              <Select value={symbol} onValueChange={setSymbol}>
                <SelectTrigger id="symbol">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="XAUUSD.s">XAUUSD.s (Gold)</SelectItem>
                  <SelectItem value="XAGUSD.s">XAGUSD.s (Silver)</SelectItem>
                  <SelectItem value="BTCUSD">BTCUSD (Bitcoin)</SelectItem>
                  <SelectItem value="ETHUSD">ETHUSD (Ethereum)</SelectItem>
                  <SelectItem value="DAX40">DAX40 (Germany 40)</SelectItem>
                  <SelectItem value="US30">US30 (Dow Jones)</SelectItem>
                  <SelectItem value="US500">US500 (S&P 500)</SelectItem>
                  <SelectItem value="NAS100">NAS100 (Nasdaq)</SelectItem>
                  <SelectItem value="UK100">UK100 (FTSE 100)</SelectItem>
                  <SelectItem value="USOIL">USOIL (WTI Crude)</SelectItem>
                  <SelectItem value="UKOIL">UKOIL (Brent Crude)</SelectItem>
                  <SelectItem value="EURUSD">EURUSD</SelectItem>
                  <SelectItem value="GBPUSD">GBPUSD</SelectItem>
                  <SelectItem value="USDJPY">USDJPY</SelectItem>
                  <SelectItem value="AUDUSD">AUDUSD</SelectItem>
                  <SelectItem value="USDCHF">USDCHF</SelectItem>
                  <SelectItem value="EURGBP">EURGBP</SelectItem>
                  <SelectItem value="NZDUSD">NZDUSD</SelectItem>
                  <SelectItem value="USDCAD">USDCAD</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Direction */}
            <div className="space-y-2">
              <Label htmlFor="direction">Direction</Label>
              <Select
                value={direction}
                onValueChange={(val) => setDirection(val as 'BUY' | 'SELL')}
              >
                <SelectTrigger id="direction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BUY">BUY (Long)</SelectItem>
                  <SelectItem value="SELL">SELL (Short)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Risk Mode Toggle */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Risk Mode</Label>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant={riskMode === 'percent' ? 'default' : 'outline'}
                    onClick={() => setRiskMode('percent')}
                    className="h-7 text-xs px-3"
                  >
                    % of Balance
                  </Button>
                  <Button
                    size="sm"
                    variant={riskMode === 'amount' ? 'default' : 'outline'}
                    onClick={() => setRiskMode('amount')}
                    className="h-7 text-xs px-3"
                  >
                    $ Amount
                  </Button>
                </div>
              </div>

              {riskMode === 'percent' ? (
                <>
                  {/* Risk Percentage Slider */}
                  <div className="flex items-center justify-between">
                    <Label htmlFor="riskPercent">Risk Percentage</Label>
                    <Badge variant="outline" className="text-sm font-semibold">
                      {riskPercent.toFixed(1)}%
                    </Badge>
                  </div>
                  <Slider
                    id="riskPercent"
                    min={0.1}
                    max={50}
                    step={0.1}
                    value={[riskPercent]}
                    onValueChange={(values) => setRiskPercent(values[0])}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Conservative (0.1%)</span>
                    <span>Aggressive (50%)</span>
                  </div>
                </>
              ) : (
                <>
                  {/* Risk Amount Input */}
                  <div className="space-y-2">
                    <Label htmlFor="riskAmount">Risk Amount ($)</Label>
                    <Input
                      id="riskAmount"
                      type="number"
                      step="10"
                      min="1"
                      value={riskAmount}
                      onChange={(e) => setRiskAmount(e.target.value)}
                      placeholder="e.g., 100"
                    />
                    <div className="flex gap-1 flex-wrap">
                      {[25, 50, 100, 200, 500].map((amt) => (
                        <Button
                          key={amt}
                          size="sm"
                          variant={riskAmount === String(amt) ? 'default' : 'outline'}
                          onClick={() => setRiskAmount(String(amt))}
                          className="h-6 text-xs px-2"
                        >
                          ${amt}
                        </Button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Calculated Lot Size (Read-only) */}
            <div className="space-y-2">
              <Label htmlFor="lotSize">
                Calculated Lot Size
                {!entryPrice || !stopLoss ? (
                  <span className="text-xs text-muted-foreground ml-2">
                    (Enter entry & SL first)
                  </span>
                ) : null}
              </Label>
              <Input
                id="lotSize"
                type="text"
                value={lotSize}
                readOnly
                className="bg-muted font-semibold"
                placeholder="Auto-calculated"
              />
              <p className="text-xs text-muted-foreground">
                {riskMode === 'percent'
                  ? `Based on ${riskPercent.toFixed(1)}% account risk`
                  : `Based on $${riskAmount || '0'} risk amount`}
              </p>
            </div>

            {/* Entry Price */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="entryPrice">Entry Price</Label>
                {currentMarketPrice && (
                  <Badge variant="outline" className="text-xs">
                    Live: {currentMarketPrice.toFixed(symbolInfo?.digits || 2)}
                  </Badge>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  id="entryPrice"
                  type="number"
                  step="0.01"
                  value={entryPrice}
                  onChange={(e) => setEntryPrice(e.target.value)}
                  placeholder="Auto-filled from market"
                  className="flex-1"
                />
                {currentMarketPrice && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const digits = symbolInfo?.digits || 2;
                      setEntryPrice(currentMarketPrice.toFixed(digits));
                    }}
                    className="shrink-0"
                  >
                    Use Live
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Auto-updates every 5 seconds
              </p>
            </div>

            {/* Stop Loss */}
            <div className="space-y-2">
              <Label htmlFor="stopLoss">Stop Loss (SL)</Label>
              <Input
                id="stopLoss"
                type="number"
                step="0.01"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                placeholder="e.g., 2640.00"
              />
            </div>

            {/* Take Profit - Toggle between Single and Multiple */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Take Profit</Label>
                <Button
                  size="sm"
                  variant={useMultipleTPs ? 'default' : 'outline'}
                  onClick={() => setUseMultipleTPs(!useMultipleTPs)}
                  className="h-7 text-xs"
                >
                  {useMultipleTPs ? 'Multiple TPs' : 'Single TP'}
                </Button>
              </div>

              {!useMultipleTPs ? (
                <Input
                  id="takeProfit"
                  type="number"
                  step="0.01"
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(e.target.value)}
                  placeholder="e.g., 2680.00"
                />
              ) : (
                <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
                  {/* TP1 */}
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">TP1</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        type="number"
                        step="0.01"
                        value={tp1Price}
                        onChange={(e) => setTp1Price(e.target.value)}
                        placeholder="Price"
                        className="text-sm"
                      />
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          step="1"
                          min="0"
                          max="100"
                          value={tp1Allocation}
                          onChange={(e) => setTp1Allocation(e.target.value)}
                          placeholder="30"
                          className="text-sm"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                      </div>
                    </div>
                  </div>

                  {/* TP2 */}
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">TP2</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        type="number"
                        step="0.01"
                        value={tp2Price}
                        onChange={(e) => setTp2Price(e.target.value)}
                        placeholder="Price"
                        className="text-sm"
                      />
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          step="1"
                          min="0"
                          max="100"
                          value={tp2Allocation}
                          onChange={(e) => setTp2Allocation(e.target.value)}
                          placeholder="30"
                          className="text-sm"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                      </div>
                    </div>
                  </div>

                  {/* TP3 */}
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">TP3</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        type="number"
                        step="0.01"
                        value={tp3Price}
                        onChange={(e) => setTp3Price(e.target.value)}
                        placeholder="Price"
                        className="text-sm"
                      />
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          step="1"
                          min="0"
                          max="100"
                          value={tp3Allocation}
                          onChange={(e) => setTp3Allocation(e.target.value)}
                          placeholder="20"
                          className="text-sm"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                      </div>
                    </div>
                  </div>

                  {/* Total Allocation */}
                  {(() => {
                    const total =
                      (parseFloat(tp1Allocation) || 0) +
                      (parseFloat(tp2Allocation) || 0) +
                      (parseFloat(tp3Allocation) || 0);
                    return (
                      <div className="flex items-center justify-between text-xs pt-2 border-t">
                        <span className="text-muted-foreground">Total Allocation:</span>
                        <Badge variant={total > 100 ? 'destructive' : total === 100 ? 'default' : 'outline'}>
                          {total}%
                        </Badge>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Custom Leverage */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="customLeverage">Leverage</Label>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant={customLeverage === '100' ? 'default' : 'outline'}
                    onClick={() => setCustomLeverage('100')}
                    className="h-7 text-xs px-2"
                  >
                    1:100
                  </Button>
                  <Button
                    size="sm"
                    variant={customLeverage === '500' ? 'default' : 'outline'}
                    onClick={() => setCustomLeverage('500')}
                    className="h-7 text-xs px-2"
                  >
                    1:500
                  </Button>
                  <Button
                    size="sm"
                    variant={customLeverage === '1000' ? 'default' : 'outline'}
                    onClick={() => setCustomLeverage('1000')}
                    className="h-7 text-xs px-2"
                  >
                    1:1000
                  </Button>
                </div>
              </div>
              <Input
                id="customLeverage"
                type="number"
                step="1"
                value={customLeverage}
                onChange={(e) => setCustomLeverage(e.target.value)}
                placeholder="1000"
              />
            </div>
          </CardContent>
        </Card>

        {/* Calculations Display */}
        <Card>
          <CardHeader>
            <CardTitle>Risk & Reward Analysis</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {calculations ? (
              <>
                {/* Position Details */}
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Position Details</h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-muted-foreground">Position Value</p>
                      <p className="font-medium">
                        ${calculations.positionValue.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Required Margin</p>
                      <p className="font-medium">
                        ${calculations.requiredMargin.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                        <span className="text-xs text-muted-foreground ml-1">
                          ({calculations.marginPercentage.toFixed(1)}%)
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Leverage</p>
                      <p className="font-medium">1:{calculations.leverage}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Pip Value/Lot</p>
                      <p className="font-medium">
                        ${calculations.pipValuePerLot.toFixed(2)}
                      </p>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Stop Loss Risk */}
                {calculations.slAmount > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <TrendingDown className="h-4 w-4 text-destructive" />
                      Capital at Risk (Stop Loss)
                    </h3>
                    <div className="rounded-lg bg-destructive/10 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          Risk Amount
                        </span>
                        <span className="text-lg font-bold text-destructive">
                          -${calculations.slAmount.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          Risk Percentage
                        </span>
                        <Badge variant="destructive">
                          {calculations.slPercentage.toFixed(2)}%
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Pips</span>
                        <span className="text-sm font-medium">
                          {calculations.slPips.toFixed(1)} pips
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Take Profit Gain */}
                {calculations.tpAmount > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-green-500" />
                      Potential Gain (Take Profit)
                    </h3>
                    <div className="rounded-lg bg-green-500/10 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          Total Profit
                        </span>
                        <span className="text-lg font-bold text-green-500">
                          +${calculations.tpAmount.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          Gain Percentage
                        </span>
                        <Badge className="bg-green-500 hover:bg-green-600">
                          {calculations.tpPercentage.toFixed(2)}%
                        </Badge>
                      </div>
                      {!useMultipleTPs && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Pips</span>
                          <span className="text-sm font-medium">
                            {calculations.tpPips.toFixed(1)} pips
                          </span>
                        </div>
                      )}

                      {/* TP Levels Breakdown */}
                      {calculations.tpLevels && calculations.tpLevels.length > 0 && (
                        <div className="mt-3 pt-3 border-t space-y-2">
                          <p className="text-xs font-semibold text-muted-foreground">
                            TP Levels Breakdown:
                          </p>
                          {calculations.tpLevels.map((tp, index) => {
                            const remainingAllocation = calculations.tpLevels!
                              .slice(index + 1)
                              .reduce((sum, t) => sum + t.allocation, 0);

                            return (
                              <div
                                key={index}
                                className="text-xs space-y-1 p-2 rounded bg-background/50"
                              >
                                <div className="flex items-center justify-between font-semibold">
                                  <span>TP{index + 1} @ {tp.price.toFixed(symbolInfo?.digits || 2)}</span>
                                  <Badge variant="outline" className="text-xs">
                                    {tp.allocation}% / ${tp.amount.toFixed(2)}
                                  </Badge>
                                </div>
                                <div className="flex items-center justify-between text-muted-foreground">
                                  <span>{tp.pips.toFixed(1)} pips</span>
                                  <span>R:R 1:{tp.rr.toFixed(2)}</span>
                                  <span>% to run: {remainingAllocation.toFixed(0)}%</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Risk/Reward Ratio */}
                {calculations.rrRatio > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold">Risk/Reward Ratio</h3>
                    <div className="rounded-lg bg-primary/10 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">R:R</span>
                        <span className="text-2xl font-bold">
                          1:{calculations.rrRatio.toFixed(2)}
                        </span>
                      </div>
                      {calculations.rrRatio < 1.5 && (
                        <div className="flex items-center gap-2 mt-2 text-xs text-yellow-600 dark:text-yellow-500">
                          <AlertCircle className="h-3 w-3" />
                          <span>Consider higher R:R ratio (1.5+)</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Warning for high risk */}
                {calculations.slPercentage > 2 && (
                  <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-3">
                    <div className="flex items-center gap-2 text-sm text-yellow-600 dark:text-yellow-500">
                      <AlertCircle className="h-4 w-4" />
                      <span>
                        Warning: Risk exceeds 2% of account balance. Consider
                        reducing lot size.
                      </span>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Calculator className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Enter trade parameters to see calculations</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
