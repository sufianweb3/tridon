import Link from "next/link";
import { ArrowRight, Check, CircleSlash, Lock, Store } from "lucide-react";
import { formatUsd } from "@agentspend/core";
import { requireUserPage } from "@/lib/server-auth";
import { getDb } from "@/lib/db";
import { policyForUser, ruleForMerchant } from "@/lib/policies";
import { merchantServices } from "@/lib/seed-data";
import { shortAccount } from "@/lib/format";
import {
  Callout,
  EmptyState,
  PageHeader,
  StatusBadge,
  TokenChip,
} from "@/components/ui";

export const metadata = { title: "Merchants" };
export const dynamic = "force-dynamic";

interface MerchantRow {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  payout_account: string;
  accent: string;
}

export default async function MerchantsPage() {
  const { user } = await requireUserPage();
  const policy = policyForUser(user.id);
  const merchants = getDb()
    .prepare("SELECT * FROM merchants WHERE active = 1 ORDER BY name")
    .all() as unknown as MerchantRow[];

  return (
    <div className="space-y-7">
      <PageHeader
        kicker="Catalogue"
        title={
          <>
            The merchant is <span className="font-serif font-normal italic">pinned</span>, not
            passed in.
          </>
        }
        description="An agent names a merchant id. The payout account comes from vault state, never from the request. Allowlisting a merchant here changes which requests need a human, not where money can go."
        actions={<TokenChip />}
      />

      <div className="grid gap-3 md:grid-cols-3">
        <Callout tone="lime" title="Payouts are immutable from the agent's side">
          The vault stores a payout account per merchant id. There is no payout parameter in the
          payment method, so a compromised agent cannot redirect funds.
        </Callout>
        <Callout tone="paper" title="Allowlisted ≠ trusted with anything">
          Allowlisting only means “inside this policy”. Per-payment caps, windows and the total
          budget still apply to every charge.
        </Callout>
        <Callout tone="amber" title="Unlisted merchants">
          {policy
            ? policy.row.unknown_merchant_mode === "deny"
              ? "This policy denies unlisted merchants outright."
              : policy.row.unknown_merchant_mode === "require_approval"
                ? "This policy holds unlisted merchants for human approval."
                : `This policy allows unlisted merchants up to ${formatUsd(
                    BigInt(policy.row.unknown_merchant_cap),
                  )} per payment.`
            : "No policy is attached yet."}
        </Callout>
      </div>

      {merchants.length === 0 ? (
        <EmptyState
          title="No merchants in the catalogue."
          body="Run the demo seed to register the platform merchants and their services."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {merchants.map((merchant) => {
            const rule = policy ? ruleForMerchant(policy, merchant.id) : null;
            const services = merchantServices(merchant.id);
            const demoFailure = merchant.id === "merchant-fail";
            return (
              <article key={merchant.id} className="card-solid overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-paper-deep/40 px-5 py-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border text-[13px] font-semibold ${
                        merchant.accent === "lime"
                          ? "border-lime-deep/50 bg-lime/30 text-moss"
                          : merchant.accent === "blue"
                            ? "border-blue/25 bg-blue-soft text-blue"
                            : "border-line-strong bg-paper text-ink-soft"
                      }`}
                    >
                      {merchant.name.slice(0, 1)}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold tracking-[-0.02em]">
                          {merchant.name}
                        </h2>
                        {rule ? (
                          rule.allowlisted ? (
                            <span className="badge border-green/30 bg-green-soft text-green">
                              <Check className="h-3 w-3" aria-hidden />
                              allowlisted
                            </span>
                          ) : (
                            <span className="badge border-line-strong bg-paper-deep text-muted">
                              <CircleSlash className="h-3 w-3" aria-hidden />
                              unlisted
                            </span>
                          )
                        ) : (
                          <span className="badge border-line-strong bg-paper-deep text-muted">
                            no rule
                          </span>
                        )}
                        {demoFailure ? (
                          <span className="badge border-rust/30 bg-rust-soft text-rust">
                            failure target
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
                        {merchant.category}
                      </p>
                    </div>
                  </div>
                  <Link
                    href={`/integrations?merchant=${merchant.id}`}
                    className="btn btn-ghost !px-3 !py-1.5 !text-xs"
                  >
                    Try payment
                    <ArrowRight className="h-3 w-3" aria-hidden />
                  </Link>
                </div>

                <div className="px-5 py-4">
                  <p className="text-xs leading-5 text-muted">{merchant.description}</p>

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-line bg-paper/60 px-3 py-2 font-mono text-[10px] text-muted">
                    <span className="flex items-center gap-1.5">
                      <Lock className="h-3 w-3" aria-hidden />
                      payout {shortAccount(merchant.payout_account)}
                    </span>
                    {rule ? (
                      <>
                        <span>
                          cap{" "}
                          {BigInt(rule.per_tx_limit) > 0n
                            ? formatUsd(BigInt(rule.per_tx_limit))
                            : "policy"}
                        </span>
                        <span>
                          window{" "}
                          {BigInt(rule.window_limit) > 0n
                            ? `${formatUsd(BigInt(rule.window_limit))} / ${Math.round(
                                rule.window_secs / 3600,
                              )}h`
                            : "none"}
                        </span>
                        <span>{rule.requires_approval ? "approval" : "auto"}</span>
                      </>
                    ) : null}
                  </div>

                  <div className="mt-4 space-y-2">
                    {services.map((service) => (
                      <div
                        key={service.id}
                        className="flex items-center justify-between gap-3 border-b border-line/70 pb-2 last:border-b-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium">{service.name}</div>
                          <div className="truncate text-[10px] text-muted">
                            {service.description}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-mono text-xs">
                            {formatUsd(BigInt(service.price))}
                          </div>
                          <Link
                            href={`/integrations?merchant=${merchant.id}&service=${service.id}`}
                            className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted hover:text-ink"
                          >
                            request →
                          </Link>
                        </div>
                      </div>
                    ))}
                    {services.length === 0 ? (
                      <p className="text-[11px] text-muted">No active services.</p>
                    ) : null}
                  </div>
                </div>

                {demoFailure ? (
                  <div className="border-t border-line bg-rust-soft/25 px-5 py-2.5 text-[10px] leading-4 text-rust">
                    This merchant is deliberately not storage-registered for the demo token, so a
                    settlement attempt fails at the token contract. It exists to prove that a
                    failed payment produces no fee and releases its reservation.
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      <div className="flex items-start gap-2 border-t border-line pt-4 text-[10px] leading-5 text-muted">
        <Store className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Merchant identity here is a platform catalogue entry, not a claim that the merchant is a
        real business. Payout accounts are testnet accounts created for this demo.
      </div>
    </div>
  );
}
