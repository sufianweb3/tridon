"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createRealtimeClient, type SealedLiveQuery } from "@neon/realtime/client";
import { RealtimeProvider, useLiveQuery } from "@neon/realtime-react";
import { formatUsd } from "@agentspend/core";
import { api, errorMessage } from "@/lib/client";
import { timeAgo } from "@/lib/format";
import { EmptyState, StatusBadge } from "@/components/ui";

export interface LivePaymentRow {
  id: string;
  status: string;
  amount_gross: string;
  created_at: string;
  updated_at: string;
  merchant_name: string;
  agent_name: string | null;
}

type LiveState = "live" | "connecting" | "stale" | "error" | "off";

const STATE_LABEL: Record<LiveState, string> = {
  live: "Live · Neon Realtime",
  connecting: "Connecting to Realtime…",
  stale: "Reconnecting…",
  error: "Live updates stopped",
  off: "Static snapshot",
};

function PaymentTable({
  rows,
  liveState,
  note,
}: {
  rows: readonly LivePaymentRow[];
  liveState: LiveState;
  note?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <span className="text-[10px] leading-4 text-muted">
          {note ?? "Rows update when the database commits a change."}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] ${
            liveState === "live"
              ? "text-green"
              : liveState === "error"
                ? "text-rust"
                : "text-muted"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              liveState === "live"
                ? "bg-green animate-pulse-dot"
                : liveState === "error"
                  ? "bg-rust"
                  : "bg-muted/50"
            }`}
          />
          {STATE_LABEL[liveState]}
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No payments yet."
          body="Use the agent console to send the first request through the policy."
          action={
            <Link href="/integrations" className="btn btn-primary !px-4 !py-2 !text-xs">
              Open agent console
            </Link>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-paper/50">
          <div className="hidden grid-cols-[1.3fr_0.9fr_0.7fr_0.7fr] gap-3 border-b border-line bg-paper-deep/60 px-4 py-2.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted md:grid">
            <span>Merchant / agent</span>
            <span>Status</span>
            <span className="text-right">Amount</span>
            <span className="text-right">When</span>
          </div>
          {rows.map((payment) => (
            <Link
              key={payment.id}
              href={`/transactions/${payment.id}`}
              className="table-row grid gap-2 px-4 py-3 md:grid-cols-[1.3fr_0.9fr_0.7fr_0.7fr] md:items-center md:gap-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{payment.merchant_name}</div>
                <div className="truncate font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
                  {payment.agent_name ?? "no agent"} · TESTUSD
                </div>
              </div>
              <div>
                <StatusBadge status={payment.status} />
              </div>
              <div className="font-mono text-sm md:text-right">
                {formatUsd(BigInt(payment.amount_gross))}
              </div>
              <div className="font-mono text-[10px] text-muted md:text-right">
                {timeAgo(Number(payment.created_at))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function SubscribedTable({
  sealed,
  refreshQuery,
  initialData,
}: {
  sealed: SealedLiveQuery<LivePaymentRow>;
  refreshQuery: () => Promise<SealedLiveQuery<LivePaymentRow>>;
  initialData: readonly LivePaymentRow[];
}) {
  const { data, status, error } = useLiveQuery(sealed, { refreshQuery, initialData });
  const rows = data ?? initialData;
  const liveState: LiveState =
    status === "error"
      ? "error"
      : status === "live"
        ? "live"
        : status === "stale"
          ? "stale"
          : "connecting";
  return (
    <PaymentTable
      rows={rows}
      liveState={liveState}
      note={status === "error" ? error.message : undefined}
    />
  );
}

function LiveInner({ initialData }: { initialData: readonly LivePaymentRow[] }) {
  const [sealed, setSealed] = useState<SealedLiveQuery<LivePaymentRow> | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const fetchSealed = useCallback(
    () =>
      api<SealedLiveQuery<LivePaymentRow>>("/api/realtime/payments", {
        method: "POST",
      }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    fetchSealed().then(
      (query) => {
        if (!cancelled) setSealed(query);
      },
      (caught: unknown) => {
        if (!cancelled) setFailure(errorMessage(caught));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fetchSealed]);

  if (!sealed) {
    return (
      <PaymentTable
        rows={initialData}
        liveState={failure ? "error" : "connecting"}
        note={failure ?? undefined}
      />
    );
  }
  return (
    <SubscribedTable
      sealed={sealed}
      refreshQuery={fetchSealed}
      initialData={initialData}
    />
  );
}

/**
 * Renders the recent-payments ledger. When Neon Realtime is configured, the
 * rows are live; otherwise the server-rendered snapshot is shown unchanged.
 */
export function LivePayments({
  realtimeUrl,
  initialData,
}: {
  realtimeUrl: string | null;
  initialData: LivePaymentRow[];
}) {
  const [client] = useState(() =>
    realtimeUrl ? createRealtimeClient({ url: realtimeUrl }) : null,
  );
  if (!client) {
    return <PaymentTable rows={initialData} liveState="off" />;
  }
  return (
    <RealtimeProvider client={client}>
      <LiveInner initialData={initialData} />
    </RealtimeProvider>
  );
}
