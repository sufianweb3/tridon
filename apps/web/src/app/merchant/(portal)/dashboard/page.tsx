import Link from "next/link";
import {
  ArrowUpRight,
  BadgeCheck,
  CircleSlash,
  Clock3,
  Plug,
  ReceiptText,
  Webhook,
} from "lucide-react";
import { requireMerchantPage } from "@/lib/server-auth";
import { merchantDashboard } from "@/lib/merchant";
import { formatDateTime, shortHash, timeAgo } from "@/lib/format";
import { CopyButton } from "@/components/actions";
import { RequestIdChip } from "@/components/merchant-actions";
import {
  Callout,
  EmptyState,
  PageHeader,
  RailBadge,
  Stat,
  StatusBadge,
  TokenChip,
} from "@/components/ui";

export const metadata = { title: "Merchant overview" };
export const dynamic = "force-dynamic";

export default async function MerchantDashboardPage() {
  const { merchant } = await requireMerchantPage();
  const dashboard = merchantDashboard(merchant.merchantId);
  const { summary, payments, requests, services, webhooks, deliveries } = dashboard;
  const rail = payments[0]?.rail ?? "testnet";
  const openRequests = requests.filter((request) => request.status === "open");
  const settled = payments.filter((payment) => payment.status === "succeeded");
  const failed = payments.filter((payment) =>
    ["failed", "denied", "expired", "revoked"].includes(payment.status),
  );
  const pendingDeliveries = deliveries.filter((delivery) => delivery.status === "pending").length;

  return (
    <div className="space-y-7">
      <PageHeader
        kicker="Merchant overview"
        title={
          <>
            {merchant.merchantName} gets paid by{" "}
            <span className="font-serif font-normal italic">proof</span>.
          </>
        }
        description="Only a verified transfer appears here as settled. An agent claiming success, or a transaction that was merely broadcast, is not payment."
        actions={
          <>
            <RailBadge rail={rail} />
            <TokenChip />
          </>
        }
      />

      <section className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-paper p-5">
          <Stat label="Net settled" value={summary.netUsd} hint="After the 0.5% merchant fee" />
        </div>
        <div className="bg-paper p-5">
          <Stat label="Gross volume" value={summary.grossUsd} hint="Verified successful payments" />
        </div>
        <div className="bg-paper p-5">
          <Stat
            label="Merchant fee"
            value={summary.merchantFeeUsd}
            hint="0.5%, only on successful payments"
          />
        </div>
        <div className="bg-paper p-5">
          <Stat
            label="Settled payments"
            value={summary.count}
            hint={
              failed.length > 0
                ? `${failed.length} blocked or failed · no fee`
                : "No failed payments recorded"
            }
          />
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-3">
        <Callout tone="lime" title="Your payout is pinned">
          The vault holds a payout account per merchant. There is no payout parameter in an agent
          request, so a compromised agent cannot redirect a payment.
        </Callout>
        <Callout tone="paper" title="The merchant fee is structural">
          It is deducted from the gross before payout and recorded only after the merchant
          transfer succeeds. A failed transfer creates no fee.
        </Callout>
        <Callout tone="amber" title="Demo scope">
          This is a seeded testnet merchant. Onboarding, KYB and production merchant auth are not
          implemented. TESTUSD is not USDC.
        </Callout>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="label">Settlements</div>
            <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">
              Every payment attempt
            </h2>
          </div>
          <Link
            href="/merchant/integrations"
            className="text-xs text-muted hover:text-ink"
          >
            Services &amp; API →
          </Link>
        </div>

        {payments.length === 0 ? (
          <EmptyState
            title="No payments yet."
            body="Create a payment request and have an agent pay it, or open the agent console from the spender workspace to send the first charge."
            action={
              <Link
                href="/merchant/integrations"
                className="btn btn-primary !px-4 !py-2 !text-xs"
              >
                Create a request
              </Link>
            }
          />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-paper/50">
            <div className="hidden grid-cols-[1.4fr_0.8fr_0.7fr_0.8fr_0.8fr] gap-3 border-b border-line bg-paper-deep/60 px-4 py-2.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted lg:grid">
              <span>Payment / agent</span>
              <span>Status</span>
              <span className="text-right">Gross</span>
              <span className="text-right">Net to you</span>
              <span className="text-right">When</span>
            </div>
            {payments.map((payment) => (
              <div
                key={payment.id}
                className="grid gap-2 border-b border-line px-4 py-3.5 last:border-b-0 lg:grid-cols-[1.4fr_0.8fr_0.7fr_0.8fr_0.8fr] lg:items-center lg:gap-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10px] text-ink-soft">{payment.id}</span>
                    <CopyButton
                      value={payment.id}
                      label="Copy payment id"
                      className="btn btn-ghost !px-1.5 !py-1 !text-[9px]"
                    />
                  </div>
                  <div className="truncate font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
                    {payment.agent?.name ?? "no agent"}
                  </div>
                </div>
                <div>
                  <StatusBadge status={payment.status} />
                </div>
                <div className="font-mono text-sm lg:text-right">{payment.grossUsd}</div>
                <div className="font-mono text-sm lg:text-right">
                  {payment.status === "succeeded" ? (
                    <span className="text-green">{payment.netUsd}</span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted lg:justify-end">
                  {timeAgo(payment.createdAt)}
                  {payment.explorerUrl ? (
                    <a
                      href={payment.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="View transaction on NEAR Blocks"
                      className="hover:text-ink"
                    >
                      <ArrowUpRight className="h-3 w-3" aria-hidden />
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="card-solid overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-paper-deep/50 px-5 py-4">
            <div>
              <div className="label">Open requests</div>
              <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
                Waiting for an agent
              </h2>
            </div>
            <span className="badge border-line-strong bg-paper text-muted">
              {openRequests.length} open
            </span>
          </div>
          {requests.length === 0 ? (
            <p className="px-5 py-5 text-xs leading-5 text-muted">
              No payment requests yet. Create one from the integrations page; the agent pays the
              fixed catalogue price, never a merchant-supplied amount.
            </p>
          ) : (
            <div className="divide-y divide-line">
              {requests.slice(0, 6).map((request) => {
                const service = services.find((item) => item.id === request.serviceId);
                return (
                  <div key={request.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {service?.name ?? request.serviceId}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-muted">
                        <RequestIdChip id={request.id} />
                        <span>expires {formatDateTime(request.requestExpiry)} UTC</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm">{request.amountUsd}</div>
                      <StatusBadge status={request.status} className="mt-1" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="space-y-5">
          <section className="card-solid overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-line bg-paper-deep/50 px-5 py-4">
              <div>
                <div className="label">Catalogue</div>
                <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
                  {services.length} active service{services.length === 1 ? "" : "s"}
                </h2>
              </div>
              <Plug className="h-4 w-4 text-muted" aria-hidden />
            </div>
            <div className="px-5 py-3">
              {services.slice(0, 4).map((service) => (
                <div
                  key={service.id}
                  className="flex items-center justify-between gap-3 border-b border-line/70 py-2.5 last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">{service.name}</div>
                    <div className="truncate text-[10px] text-muted">{service.description}</div>
                  </div>
                  <span className="shrink-0 font-mono text-xs">{service.priceUsd}</span>
                </div>
              ))}
              {services.length === 0 ? (
                <p className="py-2 text-xs text-muted">No active services.</p>
              ) : null}
            </div>
            <div className="border-t border-line px-5 py-3">
              <Link
                href="/merchant/integrations"
                className="inline-flex items-center gap-1 text-xs underline underline-offset-2 hover:text-ink"
              >
                Manage services
                <ArrowUpRight className="h-3 w-3" aria-hidden />
              </Link>
            </div>
          </section>

          <section className="card-solid overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-line bg-paper-deep/50 px-5 py-4">
              <div>
                <div className="label">Webhooks</div>
                <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
                  {webhooks.filter((endpoint) => endpoint.active).length} active endpoint
                  {webhooks.filter((endpoint) => endpoint.active).length === 1 ? "" : "s"}
                </h2>
              </div>
              <Webhook className="h-4 w-4 text-muted" aria-hidden />
            </div>
            <div className="px-5 py-4 text-xs leading-5 text-muted">
              <div className="flex items-center justify-between gap-3">
                <span>Pending deliveries</span>
                <span className="font-mono text-ink-soft">{pendingDeliveries}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-3">
                <span>Delivered</span>
                <span className="font-mono text-ink-soft">
                  {deliveries.filter((delivery) => delivery.status === "delivered").length}
                </span>
              </div>
              <p className="mt-3 text-[10px] leading-4">
                Signing uses HMAC-SHA256 over{" "}
                <code className="font-mono">&lt;timestamp&gt;.&lt;body&gt;</code>. Outbound
                delivery requires an allowlisted host.
              </p>
            </div>
          </section>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-line pt-4 text-[10px] text-muted">
        <span className="flex items-center gap-1.5">
          <BadgeCheck className="h-3.5 w-3.5 text-green" aria-hidden />
          {summary.count} verified settlement{summary.count === 1 ? "" : "s"}
        </span>
        <span className="flex items-center gap-1.5">
          <CircleSlash className="h-3.5 w-3.5 text-rust" aria-hidden />
          {failed.length} with no fee
        </span>
        <span className="flex items-center gap-1.5">
          <Clock3 className="h-3.5 w-3.5 text-amber" aria-hidden />
          {openRequests.length} open request{openRequests.length === 1 ? "" : "s"}
        </span>
        <span className="flex items-center gap-1.5">
          <ReceiptText className="h-3.5 w-3.5" aria-hidden />
          Payout {merchant.payoutAccount.slice(0, 14)}…
        </span>
        {settled[0]?.txHash ? (
          <span className="ml-auto font-mono">
            latest tx {shortHash(settled[0].txHash)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
