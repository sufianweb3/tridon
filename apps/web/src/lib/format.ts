import { formatUnits } from "@agentspend/core";

export function shortAccount(value: string | null | undefined, head = 10, tail = 6): string {
  if (!value) return "—";
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function shortHash(value: string | null | undefined): string {
  return shortAccount(value, 8, 8);
}

export function formatDateTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(ms));
}

export function timeAgo(ms: number | null | undefined, reference = Date.now()): string {
  if (!ms) return "—";
  const diff = reference - ms;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "ago" : "from now";
  if (abs < 60_000) return `${Math.max(1, Math.round(abs / 1000))}s ${suffix}`;
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m ${suffix}`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)}h ${suffix}`;
  return `${Math.round(abs / 86_400_000)}d ${suffix}`;
}

export function percentOf(part: bigint, total: bigint): number {
  if (total <= 0n) return 0;
  return Math.min(100, Number((part * 10_000n) / total) / 100);
}

export function unitsToDecimal(units: string): string {
  return formatUnits(BigInt(units));
}

export function truncateMiddle(value: string, max = 60): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.floor(max / 2))}…${value.slice(-Math.floor(max / 2))}`;
}
