import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Clock3,
  Fingerprint,
  Gauge,
  ShieldCheck,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { formatUsd } from "@agentspend/core";
import { requireUserPage } from "@/lib/server-auth";
import { userOverview } from "@/lib/views";
import { setting } from "@/lib/db";
import { shortAccount, shortHash, timeAgo } from "@/lib/format";
import {
  Callout,
  EmptyState,
  KeyValue,
  Money,
  PageHeader,
  Progress,
  RailBadge,
  Stat,
  StatusBadge,
  TokenChip,
} from "@/components/ui";
import { ApprovalActions, SyncBalanceButton } from "@/components/actions";

export const metadata = { title: "Control room" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { user, session } = await requireUserPage();
  const overview = userOverview(user.id, user);
  const policy = overview.policy;
  const vault = overview.vault;
  const budget = overview.budget;
  const pending = overview.approvals;
  const live = vault?.rail === "testnet";

  return (
    <div className="space-y-8">
      <PageHeader
        kicker="Control room"
        title={
          <>
            The leash, in <span className="font-serif font-normal italic">one screen</span>.
          </>
        }
        description={
          <>
            {live
              ? "Every number below is mirrored from a NEAR testnet vault. The contract — not this page — decides whether an agent can spend."
              : "This workspace uses the mock rail. Limits are enforced by the backend only; no chain transaction is produced."}
          </>
        }
        actions={
          <>
            <RailBadge rail={vault?.rail ?? "mock"} />
            {vault ? <SyncBalanceButton csrf={session.csrf} /> : null}
            <Link href="/integrations" className="btn btn-primary !px-4 !py-2 !text-xs">
              Run an agent payment
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </>
        }
      />

      {!vault || !policy || !budget ? (
        <EmptyState
          title="This workspace has no vault yet."
          body="Provision a vault and a policy before an agent can request a payment."
          action={
            <Link href="/policy" className="btn btn-primary !px-4 !py-2 !text-xs">
              Open policy
            </Link>
          }
        />
      ) : (
        <>
          <section className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
            <div className="bg-paper p-5">
              <Stat
                label="Available to spend"
                value={<Money units={budget.available} />}
                hint={`${budget.availableUsd} after held and committed amounts`}
              />
            </div>
            <div className="bg-paper p-5">
              <Stat
                label="Committed"
                value={<Money units={budget.committed} />}
                hint="Settled gross inside this policy"
              />
            </div>
            <div className="bg-paper p-5">
              <Stat
                label="Held"
                value={<Money units={budget.held} />}
                hint="In flight or waiting for approval"
              />
            </div>
            <div className="bg-paper p-5">
              <Stat
                label="Vault balance"
                value={<Money units={vault.balance} />}
                hint={
                  live
                    ? "NEP-141 balance held by the vault contract"
                    : "Mock ledger balance"
                }
              />
            </div>
          </section>

          <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
            <section className="card-solid overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-paper-deep/50 px-5 py-4">
                <div>
                  <div className="label">Budget</div>
                  <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
                    {policy.name}
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <span className="badge border-line-strong bg-paper text-ink-soft">
                    v{policy.version}
                  </span>
                  <StatusBadge status={policy.status} />
                </div>
              </div>

              <div className="px-5 py-5">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <div className="label">Remaining this policy</div>
                    <div className="mt-1 font-serif text-5xl leading-none tracking-[-0.03em]">
                      {formatUsd(BigInt(budget.remaining))}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="label">Total budget</div>
                    <div className="mt-1 font-mono text-sm">{formatUsd(BigInt(budget.totalBudget))}</div>
                  </div>
                </div>
                <Progress
                  part={BigInt(budget.committed) + BigInt(budget.held)}
                  total={BigInt(budget.totalBudget)}
                  tone="ink"
                  className="mt-5"
                />
                <div className="mt-2 flex flex-wrap justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
                  <span>
                    {budget.committedUsd} committed · {budget.heldUsd} held
                  </span>
                  <span>{budget.totalBudgetUsd} cap</span>
                </div>

                <div className="mt-6 grid gap-4 border-t border-line pt-5 sm:grid-cols-3">
                  <Stat label="Today" value={<Money units={budget.dayGross} />} />
                  <Stat label="7 days" value={<Money units={budget.weekGross} />} />
                  <Stat label="30 days" value={<Money units={budget.monthGross} />} />
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-line bg-paper/70 p-3">
                    <div className="label">Per payment</div>
                    <div className="mt-1.5 text-sm font-medium">
                      {formatUsd(BigInt(policy.perTxLimit))} max
                    </div>
                  </div>
                  <div className="rounded-xl border border-line bg-paper/70 p-3">
                    <div className="label">Approval rule</div>
                    <div className="mt-1.5 text-sm font-medium">{policy.approvalModeLabel}</div>
                  </div>
                </div>
              </div>
            </section>

            <div className="space-y-5">
              <section className="card-solid p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="label">Vault</div>
                    <h2 className="mt-1 text-base font-semibold tracking-[-0.02em]">
                      {live ? "On-chain account" : "Backend ledger"}
                    </h2>
                  </div>
                  <Wallet className="h-4 w-4 text-muted" aria-hidden />
                </div>
                <div className="mt-3">
                  <KeyValue label="Account" mono>
                    {shortAccount(vault.accountId)}
                  </KeyValue>
                  <KeyValue label="Network">
                    {vault.network} · {vault.chainStatus}
                  </KeyValue>
                  <KeyValue label="Asset">
                    <TokenChip />
                  </KeyValue>
                  <KeyValue label="Token contract" mono>
                    {shortAccount(vault.tokenAccount)}
                  </KeyValue>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {vault.explorerUrl ? (
                    <a
                      href={vault.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-ghost !px-3 !py-1.5 !text-xs"
                    >
                      Explorer
                      <ArrowUpRight className="h-3 w-3" aria-hidden />
                    </a>
                  ) : null}
                  <Link href="/security" className="btn btn-ghost !px-3 !py-1.5 !text-xs">
                    Enforcement model
                  </Link>
                </div>
              </section>

              <section className="card-solid p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="label">Unknown merchants</div>
                    <div className="mt-1.5 text-sm font-medium">
                      {policy.unknownMerchantModeLabel}
                    </div>
                  </div>
                  <ShieldCheck className="h-4 w-4 text-green" aria-hidden />
                </div>
                <p className="mt-2 text-xs leading-5 text-muted">
                  {policy.unknownMerchantMode === "allow_with_cap"
                    ? `Unlisted merchants are allowed only under a hard cap of ${formatUsd(
                        BigInt(policy.unknownMerchantCap),
                      )}.`
                    : "The payout account for every merchant is pinned in vault state. An agent can never choose where funds go."}
                </p>
                <div className="mt-3 border-t border-line pt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted">Allowlisted merchants</span>
                    <span className="font-mono">
                      {policy.rules.filter((rule) => rule.allowlisted && rule.active).length}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-xs">
                    <span className="text-muted">Pinned merchant rules</span>
                    <span className="font-mono">{policy.rules.length}</span>
                  </div>
                </div>
              </section>

              <Callout
                tone={live ? "lime" : "blue"}
                title={live ? "Funds sit in the vault" : "No on-chain custody"}
              >
                {live
                  ? "The owner key belongs to the user account. The platform does not hold a vault key and cannot move funds."
                  : "A wallet login never hands over a signing key, so this session cannot produce a real vault transaction."}
              </Callout>
            </div>
          </div>

          <section className="space-y-3">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="label">Human gate</div>
                <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">
                  Pending approvals
                </h2>
              </div>
              <Link href="/approvals" className="text-xs text-muted hover:text-ink">
                All approvals →
              </Link>
            </div>
            {pending.length === 0 ? (
              <EmptyState
                title="Nothing is waiting for a human."
                body="Payments inside the policy settle automatically. A request lands here only when the policy asks for approval."
              />
            ) : (
              <div className="overflow-hidden rounded-2xl border border-line">
                {pending.map((approval) => (
                  <div
                    key={approval.id}
                    className="flex flex-col gap-3 border-b border-line bg-paper/60 p-4 last:border-b-0 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{approval.merchantName}</span>
                        <span className="badge border-amber/30 bg-amber-soft text-amber">
                          <Clock3 className="h-3 w-3" aria-hidden />
                          {timeAgo(approval.expires_at)} expiry
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        {formatUsd(BigInt(approval.payment.amount_gross))} ·{" "}
                        {approval.agentName} · requested {timeAgo(approval.created_at)}
                      </div>
                    </div>
                    <ApprovalActions approvalId={approval.id} csrf={session.csrf} compact />
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
            <section className="space-y-3">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className="label">Ledger</div>
                  <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">
                    Recent transactions
                  </h2>
                </div>
                <Link href="/transactions" className="text-xs text-muted hover:text-ink">
                  Open ledger →
                </Link>
              </div>

              {overview.payments.length === 0 ? (
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
                  {overview.payments.map((payment) => (
                    <Link
                      key={payment.id}
                      href={`/transactions/${payment.id}`}
                      className="table-row grid gap-2 px-4 py-3 md:grid-cols-[1.3fr_0.9fr_0.7fr_0.7fr] md:items-center md:gap-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {payment.merchant?.name ?? payment.id}
                        </div>
                        <div className="truncate font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
                          {payment.agent?.name ?? "no agent"} · {payment.asset}
                        </div>
                      </div>
                      <div>
                        <StatusBadge status={payment.status} />
                      </div>
                      <div className="font-mono text-sm md:text-right">
                        {payment.grossUsd}
                      </div>
                      <div className="font-mono text-[10px] text-muted md:text-right">
                        {timeAgo(payment.createdAt)}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className="label">Audit trail</div>
                  <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">
                    What happened
                  </h2>
                </div>
                <Link href="/security" className="text-xs text-muted hover:text-ink">
                  Model →
                </Link>
              </div>
              <div className="rounded-2xl border border-line bg-paper/50 p-4">
                {overview.audit.length === 0 ? (
                  <p className="text-sm text-muted">No audit events yet.</p>
                ) : (
                  <ol className="space-y-3">
                    {overview.audit.slice(0, 8).map((event) => (
                      <li key={event.id} className="flex gap-3">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-line-strong" />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft">
                              {event.eventType.replaceAll("_", " ")}
                            </span>
                            <span className="text-[10px] text-muted">
                              {timeAgo(event.createdAt)}
                            </span>
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-muted">
                            {event.actor}
                            {event.paymentId ? ` · ${shortHash(event.paymentId)}` : ""}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </section>
          </div>

          <section className="space-y-3">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="label">Signing identities</div>
                <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">Agents</h2>
              </div>
              <Link href="/agents" className="text-xs text-muted hover:text-ink">
                Manage agents →
              </Link>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {overview.agents.map((agent) => (
                <Link
                  key={agent.id}
                  href="/agents"
                  className="group rounded-xl border border-line bg-paper/60 p-4 transition-colors hover:bg-paper"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{agent.name}</div>
                      <div className="mt-0.5 truncate text-[11px] text-muted">
                        {agent.description ?? "No description"}
                      </div>
                    </div>
                    <StatusBadge status={agent.status} />
                  </div>
                  {agent.budget ? (
                    <>
                      <div className="mt-4 flex items-center justify-between font-mono text-[10px] text-muted">
                        <span>{formatUsd(BigInt(agent.budget.remaining))} left</span>
                        <span>{formatUsd(BigInt(agent.budget.totalBudget))} cap</span>
                      </div>
                      <Progress
                        part={BigInt(agent.budget.committed) + BigInt(agent.budget.held)}
                        total={BigInt(agent.budget.totalBudget)}
                        tone="lime"
                        className="mt-2"
                      />
                    </>
                  ) : (
                    <p className="mt-4 text-[11px] text-muted">No budget attached.</p>
                  )}
                </Link>
              ))}
              {overview.agents.length === 0 ? (
                <EmptyState
                  title="No agents yet."
                  body="Create an agent to issue a bearer credential and a scoped on-chain key."
                  action={
                    <Link href="/agents" className="btn btn-primary !px-4 !py-2 !text-xs">
                      Create an agent
                    </Link>
                  }
                />
              ) : null}
            </div>
          </section>

          {setting("demo.user_id", "") === user.id ? (
            <Callout tone="amber" title="This is the seeded demo workspace">
              The server holds this testnet workspace&apos;s signing keys so the demo can run
              without a browser wallet. The owner of the vault is still the user account, not
              the platform. Never reuse this pattern with real funds.
            </Callout>
          ) : (
            <Callout tone="blue" title="Wallet session · mock rail">
              Your NEAR wallet signed a login message; it never handed over a signing key.
              This workspace therefore enforces limits in the backend only and labels every
              payment accordingly.
            </Callout>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5 text-[10px] text-muted">
            <span className="flex items-center gap-1.5">
              <Gauge className="h-3.5 w-3.5" aria-hidden />
              Integer base units, 6 decimals
            </span>
            <span className="flex items-center gap-1.5">
              <Fingerprint className="h-3.5 w-3.5" aria-hidden />
              FINAL receipt verification
            </span>
            <span className="flex items-center gap-1.5">
              <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
              TESTUSD is not USDC
            </span>
          </div>
        </>
      )}
    </div>
  );
}
