import Link from "next/link";
import {
  ArrowUpRight,
  BadgeCheck,
  Braces,
  KeyRound,
  ReceiptText,
  ShieldCheck,
  Store,
  Webhook,
} from "lucide-react";
import { requireMerchantPage } from "@/lib/server-auth";
import { merchantDashboard } from "@/lib/merchant";
import { formatDateTime, timeAgo } from "@/lib/format";
import { CopyButton } from "@/components/actions";
import {
  CreateServiceForm,
  MerchantDemoNote,
  RequestComposer,
  RequestIdChip,
  WebhookPanel,
} from "@/components/merchant-actions";
import {
  Callout,
  EmptyState,
  KeyValue,
  PageHeader,
  StatusBadge,
  TokenChip,
} from "@/components/ui";

export const metadata = { title: "Merchant services & API" };
export const dynamic = "force-dynamic";

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-line bg-[#12130f] px-4 py-3 font-mono text-[10px] leading-5 text-[#e8e7df]">
      {children}
    </pre>
  );
}

export default async function MerchantIntegrationsPage() {
  const { merchant, csrf } = await requireMerchantPage();
  const dashboard = await merchantDashboard(merchant.merchantId);
  const { services, requests, webhooks, deliveries, payments } = dashboard;

  return (
    <div className="space-y-7">
      <PageHeader
        kicker="Merchant API"
        title={
          <>
            Publish a price. Receive a{" "}
            <span className="font-serif font-normal italic">proof</span>.
          </>
        }
        description="Your merchant credential can create services and payment requests and receive signed webhooks. It cannot see a payer's policy, choose a payer, or move funds."
        actions={
          <>
            <TokenChip />
            <Link href="/merchant/dashboard" className="btn btn-ghost !px-3 !py-1.5 !text-xs">
              Back to overview
            </Link>
          </>
        }
      />

      <MerchantDemoNote />

      <div className="grid gap-3 md:grid-cols-3">
        <Callout tone="lime" title="Separate credential">
          The merchant bearer token is not an agent token. It is shown once at provisioning, stored
          hashed, and never placed in a URL.
        </Callout>
        <Callout tone="paper" title="The price is the catalogue">
          A payment request fixes the service and its registered price. An agent cannot pay a
          different amount against a registered service.
        </Callout>
        <Callout tone="amber" title="No payout control">
          Your payout account is pinned in the vault. This API cannot change it, and no request
          field can name a destination.
        </Callout>
      </div>

      <section className="card-solid overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-paper-deep/50 px-5 py-4">
          <div>
            <div className="label">Catalogue</div>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">Your services</h2>
          </div>
          <span className="badge border-line-strong bg-paper text-muted">
            {services.length} active
          </span>
        </div>
        <div className="grid gap-5 px-5 py-5 lg:grid-cols-[1fr_1.15fr]">
          <div className="space-y-2">
            {services.length === 0 ? (
              <EmptyState
                title="No services yet."
                body="Add a service to publish a fixed price an agent can pay."
              />
            ) : (
              services.map((service) => (
                <div
                  key={service.id}
                  className="rounded-xl border border-line bg-paper/70 px-3.5 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{service.name}</div>
                      <div className="mt-0.5 text-[10px] leading-4 text-muted">
                        {service.description || "No description"}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-sm">{service.priceUsd}</div>
                      <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
                        {service.asset} · {service.network}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="font-mono text-[9px] text-muted">{service.id}</span>
                    <CopyButton
                      value={service.id}
                      label="Copy service id"
                      className="btn btn-ghost !px-1.5 !py-0.5 !text-[9px]"
                    />
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="rounded-xl border border-line bg-paper-deep/30 p-4">
            <div className="label mb-3">Add a service</div>
            <CreateServiceForm csrf={csrf} />
          </div>
        </div>
      </section>

      <section className="card-solid overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-paper-deep/50 px-5 py-4">
          <div>
            <div className="label">Payment requests</div>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
              Ask an agent to pay
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
              A request is an offer, not an authorization. The agent&apos;s policy still decides
              whether the payment can happen.
            </p>
          </div>
          <ReceiptText className="h-4 w-4 text-muted" aria-hidden />
        </div>

        <div className="border-b border-line px-5 py-5">
          <RequestComposer
            csrf={csrf}
            services={services.map((service) => ({
              id: service.id,
              name: service.name,
              priceUsd: service.priceUsd,
            }))}
          />
        </div>

        {requests.length === 0 ? (
          <p className="px-5 py-5 text-xs text-muted">No payment requests yet.</p>
        ) : (
          <div>
            <div className="hidden grid-cols-[1.4fr_0.7fr_0.7fr_0.8fr_0.8fr] gap-3 border-b border-line bg-paper-deep/40 px-4 py-2.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted lg:grid">
              <span>Request / service</span>
              <span className="text-right">Amount</span>
              <span>Status</span>
              <span>Payment</span>
              <span className="text-right">Created</span>
            </div>
            {requests.slice(0, 12).map((request) => {
              const service = services.find((item) => item.id === request.serviceId);
              const payment = request.paymentId
                ? payments.find((item) => item.id === request.paymentId)
                : null;
              return (
                <div
                  key={request.id}
                  className="grid gap-2 border-b border-line px-4 py-3 last:border-b-0 lg:grid-cols-[1.4fr_0.7fr_0.7fr_0.8fr_0.8fr] lg:items-center lg:gap-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">
                      {service?.name ?? request.serviceId}
                    </div>
                    <div className="mt-0.5">
                      <RequestIdChip id={request.id} />
                    </div>
                  </div>
                  <div className="font-mono text-sm lg:text-right">{request.amountUsd}</div>
                  <div>
                    <StatusBadge status={request.status} />
                  </div>
                  <div className="min-w-0 font-mono text-[10px] text-muted">
                    {request.paymentId ? (
                      <span className="break-all">{request.paymentId}</span>
                    ) : (
                      "—"
                    )}
                    {payment ? (
                      <div className="mt-0.5">
                        <StatusBadge status={payment.status} />
                      </div>
                    ) : null}
                  </div>
                  <div className="font-mono text-[10px] text-muted lg:text-right">
                    {timeAgo(request.createdAt)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="card-solid overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-paper-deep/50 px-5 py-4">
          <div>
            <div className="label">Webhooks</div>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
              Signed delivery, allowlisted hosts
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
              Every event is signed. Delivery is disabled unless the endpoint host is explicitly
              allowed by the operator; the sample signature works without an endpoint.
            </p>
          </div>
          <Webhook className="h-4 w-4 text-muted" aria-hidden />
        </div>
        <div className="px-5 py-5">
          <WebhookPanel
            csrf={csrf}
            endpoints={webhooks}
            deliveries={deliveries.map((delivery) => ({
              id: delivery.id,
              payment_id: delivery.payment_id,
              event_type: delivery.event_type,
              status: delivery.status,
              attempts: delivery.attempts,
              last_error: delivery.last_error,
              created_at: delivery.created_at,
              delivered_at: delivery.delivered_at,
            }))}
          />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="card-solid overflow-hidden">
          <div className="border-b border-line bg-paper-deep/50 px-5 py-4">
            <div className="flex items-center gap-2">
              <Braces className="h-4 w-4 text-muted" aria-hidden />
              <div>
                <div className="label">Reference</div>
                <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">Merchant API</h2>
              </div>
            </div>
          </div>
          <div className="space-y-4 px-5 py-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="badge border-green/30 bg-green-soft text-green">GET</span>
                <code className="font-mono text-[11px]">/v1/merchant/services</code>
              </div>
              <Code>{`curl http://localhost:3000/v1/merchant/services \\
  -H "Authorization: Bearer $MERCHANT_TOKEN"`}</Code>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="badge border-amber/30 bg-amber-soft text-amber">POST</span>
                <code className="font-mono text-[11px]">/v1/merchant/payment-requests</code>
              </div>
              <Code>{`curl -X POST http://localhost:3000/v1/merchant/payment-requests \\
  -H "Authorization: Bearer $MERCHANT_TOKEN" \\
  -H "Idempotency-Key: order-1001" \\
  -H "Content-Type: application/json" \\
  -d '{"service_id":"${services[0]?.id ?? "svc_…"}"}'`}</Code>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="badge border-green/30 bg-green-soft text-green">GET</span>
                <code className="font-mono text-[11px]">
                  /v1/merchant/payment-requests/&lt;id&gt;
                </code>
              </div>
              <p className="mt-1.5 text-[11px] leading-4 text-muted">
                Poll a request. A request is only marked paid after the linked payment settles.
              </p>
            </div>
          </div>
        </section>

        <div className="space-y-5">
          <section className="card-solid overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-line bg-paper-deep/50 px-5 py-4">
              <div>
                <div className="label">Credential</div>
                <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
                  Your merchant token
                </h2>
              </div>
              <KeyRound className="h-4 w-4 text-muted" aria-hidden />
            </div>
            <div className="px-5 py-4 text-xs leading-5 text-muted">
              <p>
                The raw bearer token was printed once by the seed script. This portal does not
                reveal it again; it is stored as a hash.
              </p>
              <p className="mt-2">
                Re-run <code className="font-mono">pnpm seed</code> on a fresh database if you need
                a new demo credential. Rotating production credentials is out of scope.
              </p>
              <div className="mt-3 rounded-lg border border-line bg-paper-deep/40 p-2.5 font-mono text-[10px]">
                Authorization: Bearer $MERCHANT_TOKEN
              </div>
            </div>
          </section>

          <section className="card-solid overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-line bg-paper-deep/50 px-5 py-4">
              <div>
                <div className="label">Payout</div>
                <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
                  Where money lands
                </h2>
              </div>
              <Store className="h-4 w-4 text-muted" aria-hidden />
            </div>
            <div className="px-5 py-2">
              <KeyValue label="Account" mono>
                {merchant.payoutAccount}
              </KeyValue>
              <KeyValue label="Asset">TESTUSD · demo token, not USDC</KeyValue>
              <KeyValue label="Network">NEAR testnet</KeyValue>
              <KeyValue label="Fee">0.5% merchant fee on success only</KeyValue>
            </div>
            <div className="flex items-start gap-2 border-t border-line px-5 py-3 text-[10px] leading-4 text-muted">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green" aria-hidden />
              The payout account is pinned in vault state. Changing it requires the vault owner,
              not the merchant API.
            </div>
          </section>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-line pt-4 text-[10px] text-muted">
        <span className="flex items-center gap-1.5">
          <BadgeCheck className="h-3.5 w-3.5 text-green" aria-hidden />
          Settlement verified before fulfillment
        </span>
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          HMAC-SHA256 webhook signatures
        </span>
        <span className="flex items-center gap-1.5">
          <Webhook className="h-3.5 w-3.5" aria-hidden />
          {deliveries.length} recorded deliver{deliveries.length === 1 ? "y" : "ies"}
        </span>
        <Link
          href="/security"
          className="ml-auto inline-flex items-center gap-1 underline underline-offset-2 hover:text-ink"
        >
          Enforcement model
          <ArrowUpRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
