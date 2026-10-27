import Link from "next/link";
import { ArrowUpRight, CheckCircle2, CircleSlash, Clock3, ReceiptText } from "lucide-react";
import { formatUsd } from "@agentspend/core";
import { requireUserPage } from "@/lib/server-auth";
import { listPayments } from "@/lib/payments";
import { paymentView } from "@/lib/views";
import { getDb } from "@/lib/db";
import { timeAgo } from "@/lib/format";
import {
  Callout,
  EmptyState,
  PageHeader,
  RailBadge,
  Stat,
  StatusBadge,
} from "@/components/ui";

export const metadata = { title: "Transactions" };
export const dynamic = "force-dynamic";

const FILTERS = [
  { value: "", label: "All" },
  { value: "succeeded", label: "Succeeded" },
  { value: "awaiting_approval", label: "Awaiting approval" },
  { value: "submitted", label: "Submitted" },
  { value: "unknown", label: "Unknown" },
  { value: "denied", label: "Denied" },
  { value: "failed", label: "Failed" },
] as const;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { user } = await requireUserPage();
  const params = await searchParams;
  const status = params.status && params.status !== "all" ? params.status : null;
  const rows = listPayments({ userId: user.id, limit: 100, status });
  const payments = rows.map(paymentView);

  const counts = getDb()
    .prepare(
      `SELECT status, COUNT(*) AS count FROM payment_requests WHERE user_id = ? GROUP BY status`,
    )
    .all(user.id) as unknown as Array<{ status: string; count: number }>;
  const byStatus = new Map(counts.map((row) => [row.status, row.count]));
  const total = counts.reduce((sum, row) => sum + row.count, 0);
  const succeeded = byStatus.get("succeeded") ?? 0;
  const denied = (byStatus.get("denied") ?? 0) + (byStatus.get("failed") ?? 0);
  const waiting = byStatus.get("awaiting_approval") ?? 0;

  return (
    <div className="space-y-7">
      <PageHeader
        kicker="Ledger"
        title={
          <>
            Every attempt, including the <span className="font-serif font-normal italic">noes</span>.
          </>
        }
        description="A denied payment is a result, not an error. Each row records the policy decision, the fee state, and — on the live rail — the transaction whose FINAL receipt was verified."
        actions={<RailBadge rail={payments[0]?.rail ?? "testnet"} />}
      />

      <section className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-paper p-5">
          <Stat label="Attempts" value={total} hint="Across every policy version" />
        </div>
        <div className="bg-paper p-5">
          <Stat
            label="Succeeded"
            value={succeeded}
            hint={succeeded === 0 ? "No settled payments yet" : "Authoritative settlement only"}
          />
        </div>
        <div className="bg-paper p-5">
          <Stat label="Blocked or failed" value={denied} hint="No platform fee is charged" />
        </div>
        <div className="bg-paper p-5">
          <Stat label="Waiting on a human" value={waiting} hint="Reserved, not spent" />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((filter) => {
          const active = (status ?? "") === filter.value;
          const count =
            filter.value === ""
              ? total
              : filter.value === "denied"
                ? (byStatus.get("denied") ?? 0)
                : filter.value === "failed"
                  ? (byStatus.get("failed") ?? 0)
                  : (byStatus.get(filter.value) ?? 0);
          return (
            <Link
              key={filter.value || "all"}
              href={filter.value ? `/transactions?status=${filter.value}` : "/transactions"}
              className={`badge ${
                active
                  ? "border-ink bg-ink text-paper"
                  : "border-line-strong bg-paper text-muted hover:text-ink"
              }`}
            >
              {filter.label}
              <span className={active ? "text-paper/60" : "text-muted"}>{count}</span>
            </Link>
          );
        })}
      </div>

      {payments.length === 0 ? (
        <EmptyState
          title={status ? "No payments with this status." : "No payments yet."}
          body="Use the agent console to send the first request through the policy, or run the seed to populate the demo scenarios."
          action={
            <Link href="/integrations" className="btn btn-primary !px-4 !py-2 !text-xs">
              Open agent console
            </Link>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-paper/50">
          <div className="hidden grid-cols-[1.4fr_0.9fr_0.8fr_0.8fr_0.8fr] gap-3 border-b border-line bg-paper-deep/60 px-4 py-2.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted lg:grid">
            <span>Payment / merchant</span>
            <span>Status</span>
            <span className="text-right">Gross</span>
            <span className="text-right">Fees</span>
            <span className="text-right">When</span>
          </div>
          {payments.map((payment) => (
            <Link
              key={payment.id}
              href={`/transactions/${payment.id}`}
              className="table-row grid gap-2 px-4 py-3.5 lg:grid-cols-[1.4fr_0.9fr_0.8fr_0.8fr_0.8fr] lg:items-center lg:gap-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {payment.merchant?.name ?? "Unknown merchant"}
                  </span>
                  {payment.rail === "mock" ? (
                    <span className="badge border-blue/25 bg-blue-soft text-blue">mock</span>
                  ) : null}
                </div>
                <div className="truncate font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
                  {payment.id} · {payment.agent?.name ?? "no agent"}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={payment.status} />
                {payment.decision === "denied" && payment.denyCode ? (
                  <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-rust">
                    {payment.denyCode.replaceAll("_", " ")}
                  </span>
                ) : null}
              </div>
              <div className="font-mono text-sm lg:text-right">{payment.grossUsd}</div>
              <div className="font-mono text-[10px] text-muted lg:text-right">
                {payment.status === "succeeded"
                  ? `${payment.userFeeUsd} + ${payment.merchantFeeUsd}`
                  : "not charged"}
              </div>
              <div className="flex items-center gap-1 font-mono text-[10px] text-muted lg:justify-end">
                {timeAgo(payment.createdAt)}
                {payment.explorerUrl ? (
                  <ArrowUpRight className="h-3 w-3" aria-hidden />
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <Callout tone="lime" title="Succeeded means verified">
          A row is only marked succeeded after the rail verifies the expected recipient, amount,
          asset and payment reference. A broadcast transaction is not a payment.
        </Callout>
        <Callout tone="paper" title="No fee on failure">
          Fee ledger entries are created only for successful settlement. Denied, expired and
          failed payments carry no platform charge.
        </Callout>
        <Callout tone="amber" title="Unknown is not paid">
          If the rail cannot prove settlement, the payment stays unknown and the reservation is
          held for reconciliation. Never treat unknown as delivered.
        </Callout>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-line pt-4 text-[10px] text-muted">
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-green" aria-hidden />
          {succeeded} settled
        </span>
        <span className="flex items-center gap-1.5">
          <CircleSlash className="h-3.5 w-3.5 text-rust" aria-hidden />
          {denied} blocked or failed
        </span>
        <span className="flex items-center gap-1.5">
          <Clock3 className="h-3.5 w-3.5 text-amber" aria-hidden />
          {waiting} waiting
        </span>
        <span className="flex items-center gap-1.5">
          <ReceiptText className="h-3.5 w-3.5" aria-hidden />
          Integer base units, 6 decimals
        </span>
        <span className="ml-auto">{formatUsd(0n)} platform fee on blocked payments</span>
      </div>
    </div>
  );
}
