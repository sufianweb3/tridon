import Link from "next/link";
import { Clock3, Fingerprint, ShieldCheck } from "lucide-react";
import { formatUsd } from "@agentspend/core";
import { requireUserPage } from "@/lib/server-auth";
import { pendingApprovals } from "@/lib/payments";
import { query } from "@/lib/db";
import { formatDateTime, shortHash, timeAgo } from "@/lib/format";
import { ApprovalActions } from "@/components/actions";
import {
  Callout,
  EmptyState,
  KeyValue,
  PageHeader,
  StatusBadge,
} from "@/components/ui";

export const metadata = { title: "Approvals" };
export const dynamic = "force-dynamic";

interface ApprovalHistoryRow {
  id: string;
  payment_id: string;
  status: string;
  expires_at: number;
  decided_at: number | null;
  created_at: number;
  merchant_name: string;
  amount_gross: string;
  agent_name: string | null;
}

export default async function ApprovalsPage() {
  const { user, session } = await requireUserPage();
  const pending = await pendingApprovals(user.id);
  const history = await query<ApprovalHistoryRow>(
    `SELECT a.id, a.payment_id, a.status, a.expires_at, a.decided_at, a.created_at,
            m.name AS merchant_name, pr.amount_gross, ag.name AS agent_name
     FROM approvals a
     JOIN payment_requests pr ON pr.id = a.payment_id
     JOIN merchants m ON m.id = pr.merchant_id
     LEFT JOIN agents ag ON ag.id = pr.agent_id
     WHERE pr.user_id = ? AND a.status != 'pending'
     ORDER BY a.created_at DESC
     LIMIT 20`,
    [user.id],
  );

  return (
    <div className="space-y-7">
      <PageHeader
        kicker="Human gate"
        title={
          <>
            The agent asks. A person <span className="font-serif font-normal italic">answers</span>.
          </>
        }
        description="A request lands here only when the policy requires approval. Approving binds the exact payment hash; denying releases the reservation and charges no fee."
      />

      <Callout tone="lime" title="What approval does — and does not do">
        Approval releases this one request at its recorded amount and merchant. It cannot raise a
        limit, add an allowlisted merchant, or approve a different payment. The vault contract
        still checks every rule when the payment settles.
      </Callout>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="label">Waiting on you</div>
            <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">
              {pending.length === 0
                ? "Nothing is waiting"
                : `${pending.length} request${pending.length === 1 ? "" : "s"}`}
            </h2>
          </div>
          <Link href="/transactions" className="text-xs text-muted hover:text-ink">
            Open ledger →
          </Link>
        </div>

        {pending.length === 0 ? (
          <EmptyState
            title="No pending approvals."
            body="Payments that stay inside the policy settle automatically. If you want a human gate on a merchant, turn on approval for it in the policy editor."
            action={
              <Link href="/policy" className="btn btn-primary !px-4 !py-2 !text-xs">
                Edit policy
              </Link>
            }
          />
        ) : (
          <div className="grid gap-4">
            {pending.map((approval) => (
              <article key={approval.id} className="card-solid overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line bg-amber-soft/25 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-semibold tracking-[-0.02em]">
                        {approval.merchantName}
                      </span>
                      <span className="badge border-amber/30 bg-amber-soft text-amber">
                        <Clock3 className="h-3 w-3" aria-hidden />
                        expires {timeAgo(approval.expires_at)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      Requested by {approval.agentName} · {timeAgo(approval.created_at)}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="label">Amount</div>
                    <div className="mt-1 font-serif text-3xl leading-none">
                      {formatUsd(BigInt(approval.payment.amount_gross))}
                    </div>
                  </div>
                </div>

                <div className="grid gap-5 px-5 py-4 md:grid-cols-[1.1fr_0.9fr]">
                  <div>
                    <KeyValue label="Payment">
                      <Link
                        href={`/transactions/${approval.payment_id}`}
                        className="font-mono underline decoration-line-strong underline-offset-2 hover:decoration-ink"
                      >
                        {approval.payment_id}
                      </Link>
                    </KeyValue>
                    <KeyValue label="Gross / net">
                      {formatUsd(BigInt(approval.payment.amount_gross))} →{" "}
                      {formatUsd(BigInt(approval.payment.amount_net))}
                    </KeyValue>
                    <KeyValue label="Fees">
                      {formatUsd(BigInt(approval.payment.user_fee))} user ·{" "}
                      {formatUsd(BigInt(approval.payment.merchant_fee))} merchant
                    </KeyValue>
                    <KeyValue label="Requested">
                      {formatDateTime(approval.created_at)} UTC
                    </KeyValue>
                  </div>
                  <div>
                    <div className="label">Approval binding</div>
                    <p className="mt-1 text-xs leading-5 text-muted">
                      Approving signs this exact payment id, policy version and amount. The
                      approval cannot be reused for another request.
                    </p>
                    <div className="mt-2 flex items-start gap-2 rounded-lg border border-line bg-paper-deep/50 p-2.5">
                      <Fingerprint className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                      <code className="break-all font-mono text-[10px] leading-4">
                        {shortHash(approval.approval_hash)}
                      </code>
                    </div>
                    <div className="mt-3">
                      <ApprovalActions approvalId={approval.id} csrf={session.csrf} />
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <div className="label">History</div>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">Decided requests</h2>
        </div>
        {history.length === 0 ? (
          <div className="rounded-xl border border-line bg-paper/50 p-5 text-sm text-muted">
            No approvals have been decided yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-paper/50">
            <div className="hidden grid-cols-[1.2fr_0.8fr_0.7fr_0.7fr] gap-3 border-b border-line bg-paper-deep/60 px-4 py-2.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted md:grid">
              <span>Merchant / agent</span>
              <span>Decision</span>
              <span className="text-right">Amount</span>
              <span className="text-right">When</span>
            </div>
            {history.map((row) => (
              <div
                key={row.id}
                className="grid gap-2 border-b border-line px-4 py-3 last:border-b-0 md:grid-cols-[1.2fr_0.8fr_0.7fr_0.7fr] md:items-center md:gap-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/transactions/${row.payment_id}`}
                    className="truncate text-sm font-medium hover:underline"
                  >
                    {row.merchant_name}
                  </Link>
                  <div className="truncate font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
                    {row.agent_name ?? "no agent"}
                  </div>
                </div>
                <div>
                  <StatusBadge status={row.status} />
                </div>
                <div className="font-mono text-sm md:text-right">
                  {formatUsd(BigInt(row.amount_gross))}
                </div>
                <div className="font-mono text-[10px] text-muted md:text-right">
                  {row.decided_at ? timeAgo(row.decided_at) : "—"}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="flex items-start gap-2 border-t border-line pt-4 text-[10px] leading-5 text-muted">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green" aria-hidden />
        An approval reserves budget but never guarantees settlement. If the chain rejects the
        transfer, the payment is failed and no platform fee is charged.
      </div>
    </div>
  );
}
