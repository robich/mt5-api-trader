'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Radio, LineChart, Calculator, Brain } from 'lucide-react';

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/' },
  { label: 'Signals', icon: Radio, href: '/#signals' },
  { label: 'Chart', icon: LineChart, href: '/#chart' },
  { label: 'Strategy', icon: Brain, href: '/strategy-analyst' },
  { label: 'Calculator', icon: Calculator, href: '/calculator' },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:hidden">
      <div className="flex h-16 items-center justify-around">
        {navItems.map((item) => {
          const isActive =
            item.href === '/calculator'
              ? pathname === '/calculator'
              : item.href === '/strategy-analyst'
                ? pathname === '/strategy-analyst'
                : item.href === '/'
                  ? pathname === '/' && !item.href.includes('#')
                  : false;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-0.5 px-1.5 py-2 text-[10px] transition-colors ${
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <item.icon className="h-[18px] w-[18px]" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
