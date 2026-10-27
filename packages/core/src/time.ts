export const DAY_MS = 86_400_000;

/** Calendar UTC day index. All policy windows are UTC. */
export function utcDayIndex(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

export function sumDayWindow(buckets: ReadonlyMap<number, bigint>, today: number, days: number): bigint {
  let total = 0n;
  for (let i = 0; i < days; i += 1) {
    total += buckets.get(today - i) ?? 0n;
  }
  return total;
}

export function startOfUtcDay(ms: number): number {
  return utcDayIndex(ms) * DAY_MS;
}

export function formatWindow(seconds: number): string {
  if (seconds % 86400 === 0) {
    const days = seconds / 86400;
    return days === 1 ? "per day" : `per ${days} days`;
  }
  if (seconds % 3600 === 0) return `per ${seconds / 3600}h`;
  if (seconds % 60 === 0) return `per ${seconds / 60}m`;
  return `per ${seconds}s`;
}
