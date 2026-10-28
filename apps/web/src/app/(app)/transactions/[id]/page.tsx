import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  CircleSlash,
  Clock3,
  Fingerprint,
  ShieldCheck,
  Store,
} from "lucide-react";
import { formatUsd } from "@agentspend/core";
import { requireUserPage } from "@/lib/server-auth";
import { paymentDetail, receiptDownloadUrl } from "@/lib/payments";
import { paymentView } from "@/lib/views";
import { formatDateTime, shortAccount, shortHash, timeAgo } from "@/lib/format";
import { ApprovalActions, ReconcileButton } from "@/components/actions";
import {
  Callout,
  KeyValue,
  PageHeader,
  StatusBadge,
  TokenChip,
} from "@/components/ui";

export const metadata = { title: "Payment" };
export const dynamic = "force-dynamic";

function detailObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export default async function TransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user, session } = await requireUserPage();
  const { id } = await params;
  const detail = await paymentDetail(id, user.id);
  if (!detail) notFound();

  const payment = await paymentView(detail.payment);
  const view = payment;
  const live = payment.rail === "testnet";
  const failed = ["denied", "failed", "expired", "revoked"].includes(payment.status);
  const settled = payment.status === "succeeded";
  const fundsHeld = ["awaiting_approval", "authorized", "submitted", "confirming", "unknown", "held"].includes(
    payment.status,
  );
  const pendingApproval =
    detail.approval && detail.approval.status === "pending" && payment.status === "awaiting_approval";
  const reconcilable = ["submitted", "confirming", "unknown", "authorized", "held"].includes(
    payment.status,
  );
  const stopMessage = payment.denyMessage ?? payment.error ?? "The payment did not settle.";
  const stopMentionsFee = /no fee|not charged|no platform fee/i.test(stopMessage);
  const receiptUrl = settled ? await receiptDownloadUrl(payment.id, user.id) : null;

  return (
    <div className="space-y-7">
      <div>
        <Link
          href="/transactions"
          className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to the ledger
        </Link>
      </div>

      <PageHeader
        kicker={`Payment ${payment.id}`}
        title={
          <>
            {payment.merchant?.name ?? "Unknown merchant"}{" "}
            <span className="font-serif font-normal italic">
              {settled ? "was paid" : failed ? "was stopped" : "is in flight"}
            </span>
            .
          </>
        }
        description={
          <>
            {formatUsd(BigInt(payment.gross))} gross · {payment.agent?.name ?? "no agent"} ·{" "}
            {formatDateTime(payment.createdAt)} UTC
          </>
        }
        actions={
          <>
            <StatusBadge status={payment.status} />
            {reconcilable ? (
              <ReconcileButton paymentId={payment.id} csrf={session.csrf} />
            ) : null}
          </>
        }
      />

      {failed ? (
        <Callout
          tone="rust"
          title={
            payment.status === "failed"
              ? "Settlement failed"
              : `Blocked: ${payment.denyCode?.replaceAll("_", " ") ?? payment.status}`
          }
        >
          {stopMessage}
          {stopMentionsFee ? null : " No platform fee was charged, and no budget was consumed."}
        </Callout>
      ) : null}
      {pendingApproval ? (
        <Callout
          tone="amber"
          title="This request is waiting for a human"
          action={
            detail.approval ? (
              <ApprovalActions approvalId={detail.approval.id} csrf={session.csrf} compact />
            ) : null
          }
        >
          Budget is reserved but not spent. The approval expires{" "}
          {timeAgo(detail.approval?.expires_at)}. Denying it releases the reservation immediately.
        </Callout>
      ) : null}
      {payment.status === "unknown" ? (
        <Callout tone="blue" title="Settlement is unknown, so this is not paid">
          The rail could not prove the expected transfer. The reservation is still held. Use
          “Reconcile with chain” to re-check the transaction; do not deliver the service until it
          is verified.
        </Callout>
      ) : null}
      {settled ? (
        <Callout tone="lime" title="Settlement verified">
          The rail matched the expected merchant payout, asset, network and amount
          {live ? " in the transaction's FINAL receipt" : " in the mock ledger"}. Only successful
          settlement creates fee entries.
        </Callout>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-5">
          <section className="card-solid overflow-hidden">
            <div className="border-b border-line bg-paper-deep/50 px-5 py-4">
              <div className="label">Money</div>
              <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
                Gross, fees and payout
              </h2>
            </div>
            <div className="px-5 py-4">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="label">Gross</div>
                  <div className="mt-1 font-serif text-5xl leading-none tracking-[-0.03em]">
                    {formatUsd(BigInt(payment.gross))}
                  </div>
                </div>
                <div className="text-right">
                  <div className="label">Merchant receives</div>
                  <div className="mt-1 font-mono text-sm">
                    {settled
                      ? formatUsd(BigInt(payment.net))
                      : payment.status === "awaiting_approval"
                        ? "pending approval"
                        : "—"}
                  </div>
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-line bg-paper/70 p-3">
                  <div className="label">User fee · 0.5%</div>
                  <div className="mt-1.5 font-mono text-sm">
                    {payment.feeState === "charged"
                      ? payment.userFeeUsd
                      : payment.feeState === "owed"
                        ? `${payment.userFeeUsd} owed`
                        : "not charged"}
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-muted">
                    Added on top of gross and debited from the vault.
                  </p>
                </div>
                <div className="rounded-xl border border-line bg-paper/70 p-3">
                  <div className="label">Merchant fee · 0.5%</div>
                  <div className="mt-1.5 font-mono text-sm">
                    {payment.feeState === "charged"
                      ? payment.merchantFeeUsd
                      : payment.feeState === "owed"
                        ? `${payment.merchantFeeUsd} owed`
                        : "not charged"}
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-muted">
                    Deducted from gross before the payout.
                  </p>
                </div>
                <div className="rounded-xl border border-line bg-paper/70 p-3">
                  <div className="label">Vault debit</div>
                  <div className="mt-1.5 font-mono text-sm">
                    {settled
                      ? formatUsd(BigInt(payment.gross) + BigInt(payment.userFee))
                      : fundsHeld
                        ? "held"
                        : "released"}
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-muted">
                    Gross plus user fee. Reservations are released on failure.
                  </p>
                </div>
              </div>
              {detail.fees.length > 0 ? (
                <div className="mt-4 border-t border-line pt-3">
                  <div className="label mb-2">Fee ledger</div>
                  {detail.fees.map((fee) => (
                    <div
                      key={fee.kind}
                      className="flex items-center justify-between gap-3 border-b border-line/60 py-1.5 text-xs last:border-b-0"
                    >
                      <span className="text-muted">{fee.kind.replaceAll("_", " ")}</span>
                      <span className="flex items-center gap-2 font-mono">
                        {formatUsd(BigInt(fee.amount))}
                        <span className="badge border-line bg-paper-deep text-muted">
                          {fee.status}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 border-t border-line pt-3 text-[10px] text-muted">
                  No fee ledger entries exist for this payment.
                </p>
              )}
            </div>
          </section>

          <section className="card-solid overflow-hidden">
            <div className="border-b border-line bg-paper-deep/50 px-5 py-4">
              <div className="label">Rail</div>
              <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
                {live ? "NEAR testnet vault" : "Mock rail"}
              </h2>
            </div>
            <div className="px-5 py-2">
              <KeyValue label="Enforcement">{payment.enforcement}</KeyValue>
              <KeyValue label="Asset">
                <span className="inline-flex items-center gap-2">
                  {payment.asset} · {payment.network}
                  <TokenChip />
                </span>
              </KeyValue>
              <KeyValue label="Merchant payout" mono>
                {detail.merchant?.payout_account ?? "—"}
              </KeyValue>
              <KeyValue label="Transaction" mono>
                {payment.txHash ? (
                  payment.explorerUrl ? (
                    <a
                      href={payment.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 underline decoration-line-strong underline-offset-2 hover:decoration-ink"
                    >
                      {shortHash(payment.txHash)}
                      <ArrowUpRight className="h-3 w-3" aria-hidden />
                    </a>
                  ) : (
                    shortHash(payment.txHash)
                  )
                ) : (
                  "no transaction"
                )}
              </KeyValue>
              <KeyValue label="Settlement ref" mono>
                {payment.settlementRef ? shortHash(payment.settlementRef) : "—"}
              </KeyValue>
              <KeyValue label="Chain status">{payment.chainStatus ?? "—"}</KeyValue>
              <KeyValue label="Request expiry">
                {formatDateTime(payment.requestExpiry)} UTC
              </KeyValue>
            </div>
          </section>

          {detail.settlement ? (
            <section className="card-solid overflow-hidden">
              <div className="border-b border-line bg-paper-deep/50 px-5 py-4">
                <div className="label">Authoritative settlement</div>
                <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
                  What the rail verified
                </h2>
              </div>
              <div className="px-5 py-2">
                <KeyValue label="Payout" mono>
                  {detail.settlement.payout}
                </KeyValue>
                <KeyValue label="Amount net" mono>
                  {formatUsd(BigInt(detail.settlement.amount_net))}
                </KeyValue>
                <KeyValue label="Asset / network">
                  {detail.settlement.asset} · {detail.settlement.network}
                </KeyValue>
                <KeyValue label="Finality">{detail.settlement.finality}</KeyValue>
                <KeyValue label="Receipt" mono>
                  {detail.settlement.receipt_id ? shortHash(detail.settlement.receipt_id) : "—"}
                </KeyValue>
                <KeyValue label="Receipt JSON">
                  {receiptUrl ? (
                    <a
                      href={receiptUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 underline decoration-line-strong underline-offset-2 hover:decoration-ink"
                    >
                      Download from Neon Object Storage
                      <ArrowUpRight className="h-3 w-3" aria-hidden />
                    </a>
                  ) : (
                    "not stored"
                  )}
                </KeyValue>
                <KeyValue label="Verified">
                  {detail.settlement.verified_at
                    ? `${formatDateTime(detail.settlement.verified_at)} UTC`
                    : "not verified"}
                </KeyValue>
              </div>
            </section>
          ) : null}
        </div>

        <div className="space-y-5">
          <section className="card-solid p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="label">Request</div>
                <h2 className="mt-1 text-base font-semibold tracking-[-0.02em]">
                  Who asked for what
                </h2>
              </div>
              <Store className="h-4 w-4 text-muted" aria-hidden />
            </div>
            <div className="mt-2">
              <KeyValue label="Merchant">
                {detail.merchant ? (
                  <Link href="/merchants" className="hover:underline">
                    {detail.merchant.name}
                  </Link>
                ) : (
                  "Unknown"
                )}
              </KeyValue>
              <KeyValue label="Category">{detail.merchant?.category ?? "—"}</KeyValue>
              <KeyValue label="Agent">
                {detail.agent ? (
                  <Link href="/agents" className="hover:underline">
                    {detail.agent.name}
                  </Link>
                ) : (
                  "no agent"
                )}
              </KeyValue>
              <KeyValue label="Policy">{detail.policyName ?? "—"}</KeyValue>
              <KeyValue label="Idempotency key" mono>
                {shortHash(detail.payment.idempotency_key)}
              </KeyValue>
              <KeyValue label="Rail">
                {live ? "NEAR testnet · on-chain" : "Mock · backend only"}
              </KeyValue>
            </div>
          </section>

          {detail.approval ? (
            <section className="card-solid p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="label">Approval</div>
                  <h2 className="mt-1 text-base font-semibold tracking-[-0.02em]">
                    {detail.approval.status}
                  </h2>
                </div>
                <Fingerprint className="h-4 w-4 text-muted" aria-hidden />
              </div>
              <div className="mt-2">
                <KeyValue label="Hash" mono>
                  {shortHash(detail.approval.approval_hash)}
                </KeyValue>
                <KeyValue label="Created">{timeAgo(detail.approval.created_at)}</KeyValue>
                <KeyValue label="Expires">{timeAgo(detail.approval.expires_at)}</KeyValue>
                <KeyValue label="Decided">
                  {detail.approval.decided_at ? timeAgo(detail.approval.decided_at) : "—"}
                </KeyValue>
              </div>
              {pendingApproval ? (
                <div className="mt-3">
                  <ApprovalActions approvalId={detail.approval.id} csrf={session.csrf} />
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="card-solid p-5">
            <div className="label">Timeline</div>
            <h2 className="mt-1 text-base font-semibold tracking-[-0.02em]">
              Policy decision to settlement
            </h2>
            <ol className="mt-3 space-y-3">
              {detail.timeline.map((event) => {
                const extra = detailObject(event.detail);
                const reason =
                  typeof extra.reason === "string"
                    ? extra.reason
                    : typeof extra.code === "string"
                      ? extra.code
                      : null;
                return (
                  <li key={event.id} className="flex gap-3">
                    <span
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        event.event_type.includes("fail") || event.event_type.includes("deny")
                          ? "bg-rust"
                          : event.event_type.includes("settle") ||
                              event.event_type.includes("succeed")
                            ? "bg-green"
                            : "bg-line-strong"
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft">
                          {event.event_type.replaceAll("_", " ")}
                        </span>
                        <span className="text-[10px] text-muted">{timeAgo(event.created_at)}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted">
                        {event.actor}
                        {reason ? ` · ${reason}` : ""}
                      </div>
                    </div>
                  </li>
                );
              })}
              {detail.timeline.length === 0 ? (
                <li className="text-xs text-muted">No audit events recorded.</li>
              ) : null}
            </ol>
          </section>

          {detail.attempts.length > 0 ? (
            <section className="card-solid p-5">
              <div className="label">Attempts</div>
              <div className="mt-2 space-y-2">
                {detail.attempts.map((attempt) => (
                  <div
                    key={attempt.id}
                    className="flex items-center justify-between gap-3 border-b border-line/60 pb-2 text-xs last:border-b-0"
                  >
                    <span className="font-mono text-[10px] text-muted">
                      #{attempt.attempt_no} · {attempt.rail}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[10px]">{attempt.status}</span>
                      {attempt.tx_hash ? (
                        <span className="font-mono text-[10px] text-muted">
                          {shortAccount(attempt.tx_hash, 6, 6)}
                        </span>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-line pt-4 text-[10px] text-muted">
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-green" aria-hidden />
          Verified settlement only
        </span>
        <span className="flex items-center gap-1.5">
          <CircleSlash className="h-3.5 w-3.5 text-rust" aria-hidden />
          No fee on blocked or failed
        </span>
        <span className="flex items-center gap-1.5">
          <Clock3 className="h-3.5 w-3.5 text-amber" aria-hidden />
          Reservations expire
        </span>
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          Payout pinned in vault state
        </span>
      </div>
    </div>
  );
}
