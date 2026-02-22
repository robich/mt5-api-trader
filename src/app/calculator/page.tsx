'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import TradeCalculator from '@/components/dashboard/TradeCalculator';

export default function CalculatorPage() {
  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header with back button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Back to Dashboard</span>
                <span className="sm:hidden">Back</span>
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold">Trade Calculator</h1>
              <p className="text-muted-foreground">
                Calculate position size, risk, and potential reward
              </p>
            </div>
          </div>
        </div>

        {/* Trade Calculator Component */}
        <TradeCalculator />
      </div>
    </div>
  );
}
