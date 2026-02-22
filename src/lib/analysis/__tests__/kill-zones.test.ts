import { describe, it, expect } from 'vitest';
import {
  isInKillZone,
  getCurrentSession,
  getActiveKillZone,
  getKillZoneBonus,
  isHighProbabilityTime,
  getActiveKillZones,
  shouldAvoidTrading,
  getSessionDescription,
  getMinutesUntilNextKillZone,
  KILL_ZONES,
} from '../kill-zones';

function utcDate(hour: number, minute: number = 0, dayOfWeek?: number): Date {
  // Create a date at a specific UTC hour
  const d = new Date('2026-02-16T00:00:00Z'); // Monday
  if (dayOfWeek !== undefined) {
    // Adjust day: Feb 16 2026 is Monday (1), so adjust to target day
    const currentDay = d.getUTCDay(); // 1 = Monday
    d.setUTCDate(d.getUTCDate() + (dayOfWeek - currentDay));
  }
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

describe('isInKillZone', () => {
  it('should detect London Open kill zone (07:00-10:00 UTC)', () => {
    expect(isInKillZone(utcDate(7))).toBe(true);
    expect(isInKillZone(utcDate(8))).toBe(true);
    expect(isInKillZone(utcDate(9))).toBe(true);
  });

  it('should detect NY Open kill zone (12:00-15:00 UTC)', () => {
    expect(isInKillZone(utcDate(12))).toBe(true);
    expect(isInKillZone(utcDate(13))).toBe(true);
    expect(isInKillZone(utcDate(14))).toBe(true);
  });

  it('should detect London/NY Overlap (12:00-16:00 UTC)', () => {
    expect(isInKillZone(utcDate(15))).toBe(true); // Only overlap has this
  });

  it('should return false outside kill zones', () => {
    expect(isInKillZone(utcDate(3))).toBe(false); // Asian session
    expect(isInKillZone(utcDate(20))).toBe(false); // Off hours
    expect(isInKillZone(utcDate(6))).toBe(false); // Just before London
  });

  it('should respect custom zone list', () => {
    // Only check Asian zone
    expect(isInKillZone(utcDate(3), ['ASIAN'])).toBe(true);
    expect(isInKillZone(utcDate(8), ['ASIAN'])).toBe(false);
  });

  it('should return false at zone boundaries (exclusive end)', () => {
    expect(isInKillZone(utcDate(10), ['LONDON_OPEN'])).toBe(false); // London ends at 10
    expect(isInKillZone(utcDate(15), ['NY_OPEN'])).toBe(false); // NY ends at 15
  });
});

describe('getCurrentSession', () => {
  it('should identify Asian session (00:00-07:00 UTC)', () => {
    expect(getCurrentSession(utcDate(0))).toBe('ASIAN');
    expect(getCurrentSession(utcDate(3))).toBe('ASIAN');
    expect(getCurrentSession(utcDate(6))).toBe('ASIAN');
  });

  it('should identify London session (07:00-12:00 UTC)', () => {
    expect(getCurrentSession(utcDate(7))).toBe('LONDON');
    expect(getCurrentSession(utcDate(10))).toBe('LONDON');
    expect(getCurrentSession(utcDate(11))).toBe('LONDON');
  });

  it('should identify Overlap session (12:00-16:00 UTC)', () => {
    expect(getCurrentSession(utcDate(12))).toBe('OVERLAP');
    expect(getCurrentSession(utcDate(14))).toBe('OVERLAP');
    expect(getCurrentSession(utcDate(15))).toBe('OVERLAP');
  });

  it('should identify NY session (16:00-21:00 UTC)', () => {
    expect(getCurrentSession(utcDate(16))).toBe('NEW_YORK');
    expect(getCurrentSession(utcDate(18))).toBe('NEW_YORK');
    expect(getCurrentSession(utcDate(20))).toBe('NEW_YORK');
  });

  it('should identify Off Hours (21:00-00:00 UTC)', () => {
    expect(getCurrentSession(utcDate(21))).toBe('OFF_HOURS');
    expect(getCurrentSession(utcDate(23))).toBe('OFF_HOURS');
  });
});

describe('getActiveKillZone', () => {
  it('should return London/NY Overlap with highest priority during overlap hours', () => {
    const zone = getActiveKillZone(utcDate(13));
    expect(zone).not.toBeNull();
    expect(zone!.type).toBe('LONDON_NY_OVERLAP');
  });

  it('should return London Open during London hours', () => {
    const zone = getActiveKillZone(utcDate(8));
    expect(zone).not.toBeNull();
    expect(zone!.type).toBe('LONDON_OPEN');
  });

  it('should return Asian during Asian hours', () => {
    const zone = getActiveKillZone(utcDate(3));
    expect(zone).not.toBeNull();
    expect(zone!.type).toBe('ASIAN');
  });

  it('should return null during off hours', () => {
    expect(getActiveKillZone(utcDate(22))).toBeNull();
  });
});

describe('getKillZoneBonus', () => {
  it('should return 0.2 during London/NY Overlap', () => {
    expect(getKillZoneBonus(utcDate(13))).toBe(0.2);
  });

  it('should return 0.15 during London Open', () => {
    expect(getKillZoneBonus(utcDate(8))).toBe(0.15);
  });

  it('should return 0.05 during Asian session', () => {
    expect(getKillZoneBonus(utcDate(3))).toBe(0.05);
  });

  it('should return 0 during off hours', () => {
    expect(getKillZoneBonus(utcDate(22))).toBe(0);
  });
});

describe('isHighProbabilityTime', () => {
  it('should return true during London open', () => {
    expect(isHighProbabilityTime(utcDate(8))).toBe(true);
  });

  it('should return true during NY open', () => {
    expect(isHighProbabilityTime(utcDate(13))).toBe(true);
  });

  it('should return false during Asian session', () => {
    expect(isHighProbabilityTime(utcDate(3))).toBe(false);
  });

  it('should return false during off hours', () => {
    expect(isHighProbabilityTime(utcDate(22))).toBe(false);
  });
});

describe('getActiveKillZones', () => {
  it('should return multiple zones during overlap', () => {
    const zones = getActiveKillZones(utcDate(13));
    const types = zones.map((z) => z.type);
    expect(types).toContain('NY_OPEN');
    expect(types).toContain('LONDON_NY_OVERLAP');
  });

  it('should return single zone during London-only hours', () => {
    const zones = getActiveKillZones(utcDate(8));
    expect(zones).toHaveLength(1);
    expect(zones[0].type).toBe('LONDON_OPEN');
  });

  it('should return empty during off hours', () => {
    expect(getActiveKillZones(utcDate(22))).toHaveLength(0);
  });
});

describe('shouldAvoidTrading', () => {
  it('should avoid trading on weekends (Saturday)', () => {
    expect(shouldAvoidTrading(utcDate(10, 0, 6))).toBe(true); // Saturday
  });

  it('should avoid trading on weekends (Sunday)', () => {
    expect(shouldAvoidTrading(utcDate(10, 0, 0))).toBe(true); // Sunday
  });

  it('should avoid trading during off hours', () => {
    expect(shouldAvoidTrading(utcDate(22, 0, 1))).toBe(true); // Monday 22:00
  });

  it('should not avoid trading during London session on weekday', () => {
    expect(shouldAvoidTrading(utcDate(8, 0, 1))).toBe(false); // Monday 08:00
  });

  it('should not avoid trading during NY session on weekday', () => {
    expect(shouldAvoidTrading(utcDate(14, 0, 3))).toBe(false); // Wednesday 14:00
  });
});

describe('getSessionDescription', () => {
  it('should return kill zone description during London open', () => {
    const desc = getSessionDescription(utcDate(8));
    expect(desc).toContain('London');
  });

  it('should return overlap description', () => {
    const desc = getSessionDescription(utcDate(13));
    expect(desc).toContain('Overlap');
  });

  it('should return Off-Hours description', () => {
    const desc = getSessionDescription(utcDate(22));
    expect(desc).toContain('Off-Hours');
  });
});

describe('getMinutesUntilNextKillZone', () => {
  it('should calculate minutes until London from early morning', () => {
    // At 05:00, next KZ is London at 07:00 = 120 minutes
    const mins = getMinutesUntilNextKillZone(utcDate(5, 0));
    expect(mins).toBe(120);
  });

  it('should calculate minutes until NY from late London', () => {
    // At 10:30, next KZ is NY at 12:00 = 90 minutes
    const mins = getMinutesUntilNextKillZone(utcDate(10, 30));
    expect(mins).toBe(90);
  });

  it('should wrap around to next day London after NY', () => {
    // At 16:00, next KZ is tomorrow's London at 07:00
    // (24*60 - 16*60) + 7*60 = 480 + 420 = 900 minutes
    const mins = getMinutesUntilNextKillZone(utcDate(16, 0));
    expect(mins).toBe(900);
  });
});
