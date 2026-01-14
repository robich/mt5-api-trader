/**
 * Kill Zones Analysis for Smart Money Concepts
 * Identifies optimal trading windows based on market sessions
 *
 * Kill zones are high-volatility periods where institutional traders are most active:
 * - London Open: 07:00-10:00 UTC
 * - New York Open: 12:00-15:00 UTC
 * - London/NY Overlap: 12:00-16:00 UTC (highest volatility)
 */

export type KillZoneType = 'LONDON_OPEN' | 'NY_OPEN' | 'LONDON_NY_OVERLAP' | 'ASIAN';
export type Session = 'ASIAN' | 'LONDON' | 'NEW_YORK' | 'OVERLAP' | 'OFF_HOURS';

export interface KillZone {
  type: KillZoneType;
  startHour: number; // UTC hour
  endHour: number;   // UTC hour
  confidenceBoost: number; // 0-0.2 boost to signal confidence
  description: string;
}

// Kill zone definitions (all times in UTC)
export const KILL_ZONES: Record<KillZoneType, KillZone> = {
  LONDON_OPEN: {
    type: 'LONDON_OPEN',
    startHour: 7,
    endHour: 10,
    confidenceBoost: 0.15,
    description: 'London Open (07:00-10:00 UTC)',
  },
  NY_OPEN: {
    type: 'NY_OPEN',
    startHour: 12,
    endHour: 15,
    confidenceBoost: 0.15,
    description: 'New York Open (12:00-15:00 UTC)',
  },
  LONDON_NY_OVERLAP: {
    type: 'LONDON_NY_OVERLAP',
    startHour: 12,
    endHour: 16,
    confidenceBoost: 0.2,
    description: 'London/NY Overlap (12:00-16:00 UTC)',
  },
  ASIAN: {
    type: 'ASIAN',
    startHour: 0,
    endHour: 7,
    confidenceBoost: 0.05, // Lower confidence during Asian session (typically ranging)
    description: 'Asian Session (00:00-07:00 UTC)',
  },
};

// Session time ranges (UTC)
const SESSION_RANGES = {
  ASIAN: { start: 0, end: 7 },
  LONDON: { start: 7, end: 12 },
  OVERLAP: { start: 12, end: 16 },
  NEW_YORK: { start: 16, end: 21 },
  OFF_HOURS: { start: 21, end: 24 }, // 21:00-00:00 UTC
};

/**
 * Check if a given time is within any of the specified kill zones
 */
export function isInKillZone(
  time: Date,
  zones: KillZoneType[] = ['LONDON_OPEN', 'NY_OPEN', 'LONDON_NY_OVERLAP']
): boolean {
  const hour = time.getUTCHours();

  for (const zoneType of zones) {
    const zone = KILL_ZONES[zoneType];
    if (isHourInRange(hour, zone.startHour, zone.endHour)) {
      return true;
    }
  }

  return false;
}

/**
 * Get the current market session
 */
export function getCurrentSession(time: Date): Session {
  const hour = time.getUTCHours();

  // Check for overlap first (most specific)
  if (isHourInRange(hour, SESSION_RANGES.OVERLAP.start, SESSION_RANGES.OVERLAP.end)) {
    return 'OVERLAP';
  }

  if (isHourInRange(hour, SESSION_RANGES.ASIAN.start, SESSION_RANGES.ASIAN.end)) {
    return 'ASIAN';
  }

  if (isHourInRange(hour, SESSION_RANGES.LONDON.start, SESSION_RANGES.LONDON.end)) {
    return 'LONDON';
  }

  if (isHourInRange(hour, SESSION_RANGES.NEW_YORK.start, SESSION_RANGES.NEW_YORK.end)) {
    return 'NEW_YORK';
  }

  return 'OFF_HOURS';
}

/**
 * Get the active kill zone at the given time
 */
export function getActiveKillZone(time: Date): KillZone | null {
  const hour = time.getUTCHours();

  // Check in priority order (overlap has highest priority)
  if (isHourInRange(hour, KILL_ZONES.LONDON_NY_OVERLAP.startHour, KILL_ZONES.LONDON_NY_OVERLAP.endHour)) {
    return KILL_ZONES.LONDON_NY_OVERLAP;
  }

  if (isHourInRange(hour, KILL_ZONES.LONDON_OPEN.startHour, KILL_ZONES.LONDON_OPEN.endHour)) {
    return KILL_ZONES.LONDON_OPEN;
  }

  if (isHourInRange(hour, KILL_ZONES.NY_OPEN.startHour, KILL_ZONES.NY_OPEN.endHour)) {
    return KILL_ZONES.NY_OPEN;
  }

  if (isHourInRange(hour, KILL_ZONES.ASIAN.startHour, KILL_ZONES.ASIAN.endHour)) {
    return KILL_ZONES.ASIAN;
  }

  return null;
}

/**
 * Get confidence boost based on current kill zone
 * Returns 0 if not in any kill zone, otherwise returns the zone's boost
 */
export function getKillZoneBonus(time: Date): number {
  const zone = getActiveKillZone(time);
  return zone ? zone.confidenceBoost : 0;
}

/**
 * Check if current time is in a high-probability kill zone (London or NY)
 */
export function isHighProbabilityTime(time: Date): boolean {
  return isInKillZone(time, ['LONDON_OPEN', 'NY_OPEN', 'LONDON_NY_OVERLAP']);
}

/**
 * Get all active kill zones at the given time (can be multiple due to overlap)
 */
export function getActiveKillZones(time: Date): KillZone[] {
  const hour = time.getUTCHours();
  const activeZones: KillZone[] = [];

  for (const zone of Object.values(KILL_ZONES)) {
    if (isHourInRange(hour, zone.startHour, zone.endHour)) {
      activeZones.push(zone);
    }
  }

  return activeZones;
}

/**
 * Check if we should avoid trading at this time (Asian session ranging or off-hours)
 */
export function shouldAvoidTrading(time: Date): boolean {
  const session = getCurrentSession(time);
  const dayOfWeek = time.getUTCDay();

  // Avoid weekends
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return true;
  }

  // Optionally avoid off-hours
  if (session === 'OFF_HOURS') {
    return true;
  }

  return false;
}

/**
 * Get a human-readable description of the current trading session
 */
export function getSessionDescription(time: Date): string {
  const session = getCurrentSession(time);
  const zone = getActiveKillZone(time);

  if (zone) {
    return zone.description;
  }

  switch (session) {
    case 'ASIAN':
      return 'Asian Session (Low Volatility)';
    case 'LONDON':
      return 'London Session';
    case 'NEW_YORK':
      return 'New York Session';
    case 'OVERLAP':
      return 'London/NY Overlap (High Volatility)';
    case 'OFF_HOURS':
      return 'Off-Hours (Low Liquidity)';
    default:
      return 'Unknown Session';
  }
}

/**
 * Helper function to check if an hour is within a range
 */
function isHourInRange(hour: number, start: number, end: number): boolean {
  if (start <= end) {
    return hour >= start && hour < end;
  } else {
    // Handle ranges that cross midnight (e.g., 22:00 to 02:00)
    return hour >= start || hour < end;
  }
}

/**
 * Get the number of minutes until the next kill zone starts
 */
export function getMinutesUntilNextKillZone(time: Date): number {
  const hour = time.getUTCHours();
  const minutes = time.getUTCMinutes();
  const currentMinutes = hour * 60 + minutes;

  // Kill zone start times in minutes from midnight
  const killZoneStarts = [
    KILL_ZONES.LONDON_OPEN.startHour * 60,  // 7:00 = 420 min
    KILL_ZONES.NY_OPEN.startHour * 60,      // 12:00 = 720 min
  ];

  for (const startMinutes of killZoneStarts) {
    if (startMinutes > currentMinutes) {
      return startMinutes - currentMinutes;
    }
  }

  // Next kill zone is tomorrow's London open
  return (24 * 60 - currentMinutes) + killZoneStarts[0];
}
