"use client";

import { useEffect, useState } from "react";
import { formatDateTime, timeAgo } from "@/lib/format";

/**
 * Relative timestamps are computed from `Date.now()`, which differs between the
 * server render and the client hydration. Render a stable absolute time first,
 * then switch to the relative form after mount.
 */
export function RelativeTime({
  at,
  fallback = "—",
}: {
  at: number | null | undefined;
  fallback?: string;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!at) return <>{fallback}</>;
  return <>{mounted ? timeAgo(at) : `${formatDateTime(at)} UTC`}</>;
}
