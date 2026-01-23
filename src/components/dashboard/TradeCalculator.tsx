'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
  getSymbolPipInfo,
} from '@/lib/risk/position-sizing';
import { SymbolInfo } from '@/lib/types';
import { Calculator, TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';

// Default symbol specifications
const DEFAULT_SYMBOL_INFO: Record<string, Partial<SymbolInfo>> = {
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
  const [entryPrice, setEntryPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [customLeverage, setCustomLeverage] = useState('');

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
    const leverage = parseFloat(customLeverage) || accountInfo?.leverage || 100;
    const balance = accountInfo?.balance || 10000;

    if (lots <= 0 || entry <= 0) return null;

    // Calculate pip values
    const pipInfo = getSymbolPipInfo(symbolInfo.symbol);
    const pipValuePerLot = (symbolInfo.contractSize * symbolInfo.pipSize) / entry;

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

    // Calculate take profit metrics
    let tpPips = 0;
    let tpAmount = 0;
    let tpPercentage = 0;
    let rrRatio = 0;

    if (tp > 0) {
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
  ]);

  // Auto-calculate lot size based on risk percentage
  const handleCalculateByRisk = (riskPercent: number) => {
    if (!symbolInfo || !accountInfo || !entryPrice || !stopLoss) return;

    const entry = parseFloat(entryPrice);
    const sl = parseFloat(stopLoss);

    if (entry <= 0 || sl <= 0) return;

    const result = calculatePositionSize(
      accountInfo.balance,
      riskPercent,
      entry,
      sl,
      symbolInfo
    );

    setLotSize(result.lotSize.toFixed(2));
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
      {accountInfo && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex gap-6">
                <div>
                  <p className="text-sm text-muted-foreground">Balance</p>
                  <p className="text-lg font-semibold">
                    ${accountInfo.balance.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Equity</p>
                  <p className="text-lg font-semibold">
                    ${accountInfo.equity.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Free Margin</p>
                  <p className="text-lg font-semibold">
                    ${accountInfo.freeMargin.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Leverage</p>
                  <p className="text-lg font-semibold">1:{accountInfo.leverage}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
                  <SelectItem value="BTCUSD">BTCUSD</SelectItem>
                  <SelectItem value="ETHUSD">ETHUSD</SelectItem>
                  <SelectItem value="EURUSD">EURUSD</SelectItem>
                  <SelectItem value="GBPUSD">GBPUSD</SelectItem>
                  <SelectItem value="USDJPY">USDJPY</SelectItem>
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

            {/* Lot Size */}
            <div className="space-y-2">
              <Label htmlFor="lotSize">Lot Size</Label>
              <Input
                id="lotSize"
                type="number"
                step="0.01"
                min="0.01"
                value={lotSize}
                onChange={(e) => setLotSize(e.target.value)}
                placeholder="0.01"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCalculateByRisk(1)}
                  className="text-xs"
                >
                  1% Risk
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCalculateByRisk(2)}
                  className="text-xs"
                >
                  2% Risk
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCalculateByRisk(3)}
                  className="text-xs"
                >
                  3% Risk
                </Button>
              </div>
            </div>

            {/* Entry Price */}
            <div className="space-y-2">
              <Label htmlFor="entryPrice">Entry Price</Label>
              <Input
                id="entryPrice"
                type="number"
                step="0.01"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                placeholder="e.g., 2650.50"
              />
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

            {/* Take Profit */}
            <div className="space-y-2">
              <Label htmlFor="takeProfit">Take Profit (TP)</Label>
              <Input
                id="takeProfit"
                type="number"
                step="0.01"
                value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value)}
                placeholder="e.g., 2680.00"
              />
            </div>

            {/* Custom Leverage (Optional) */}
            <div className="space-y-2">
              <Label htmlFor="customLeverage">
                Leverage (Optional, defaults to account leverage)
              </Label>
              <Input
                id="customLeverage"
                type="number"
                step="1"
                value={customLeverage}
                onChange={(e) => setCustomLeverage(e.target.value)}
                placeholder={`Default: ${accountInfo?.leverage || 100}`}
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
                          Profit Amount
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
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Pips</span>
                        <span className="text-sm font-medium">
                          {calculations.tpPips.toFixed(1)} pips
                        </span>
                      </div>
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
