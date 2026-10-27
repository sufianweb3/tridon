import Link from "next/link";
import { ArrowUpRight, KeyRound, Webhook } from "lucide-react";
import { requireUserPage } from "@/lib/server-auth";
import { listAgents } from "@/lib/agents";
import { policyForUser, ruleForMerchant } from "@/lib/policies";
import { getDb } from "@/lib/db";
import { merchantServices } from "@/lib/seed-data";
import { vaultForUser } from "@/lib/platform";
import { Callout, PageHeader, RailBadge } from "@/components/ui";
import { CopyButton } from "@/components/actions";
import { AgentConsole } from "@/components/agent-console";

export const metadata = { title: "Agent API" };
export const dynamic = "force-dynamic";

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-line bg-[#12130f] px-4 py-3 font-mono text-[10px] leading-5 text-[#e8e7df]">
      {children}
    </pre>
  );
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; merchant?: string; service?: string }>;
}) {
  const { user, session } = await requireUserPage();
  const params = await searchParams;
  const agents = listAgents(user.id);
  const vault = vaultForUser(user.id);
  const policy = policyForUser(user.id);
  const merchants = getDb()
    .prepare("SELECT id, name, category FROM merchants WHERE active = 1 ORDER BY name")
    .all() as unknown as Array<{ id: string; name: string; category: string }>;

  const options = merchants.map((merchant) => {
    const rule = policy ? ruleForMerchant(policy, merchant.id) : null;
    return {
      id: merchant.id,
      name: merchant.name,
      category: merchant.category,
      allowlisted: rule?.allowlisted === 1,
      services: merchantServices(merchant.id).map((service) => ({
        id: service.id,
        name: service.name,
        price: service.price,
      })),
    };
  });

  return (
    <div className="space-y-7">
      <PageHeader
        kicker="Agent API"
        title={
          <>
            The agent gets an <span className="font-serif font-normal italic">API</span>, not a
            wallet.
          </>
        }
        description="Agents authenticate with a bearer credential, ask for a merchant service, and receive a deterministic decision. The credential cannot withdraw, change a limit, or name a payout account."
        actions={
          <>
            <RailBadge rail={vault?.rail ?? "mock"} />
            <Link href="/agents" className="btn btn-ghost !px-3 !py-1.5 !text-xs">
              <KeyRound className="h-3.5 w-3.5" aria-hidden />
              Issue a credential
            </Link>
          </>
        }
      />

      <div className="grid gap-3 md:grid-cols-3">
        <Callout tone="lime" title="Scope is the point">
          The live rail adds a function-call key scoped to <code className="font-mono">pay</code>{" "}
          on one vault. Even if the bearer token leaks, the contract still applies the policy.
        </Callout>
        <Callout tone="paper" title="One key per agent">
          Rotating a bearer token revokes the old one immediately. Revoking an agent deletes its
          on-chain key before the backend record changes.
        </Callout>
        <Callout tone="amber" title="Idempotency is required">
          Every write needs an <code className="font-mono">Idempotency-Key</code>. Replaying the
          same key returns the original payment instead of charging twice.
        </Callout>
      </div>

      <AgentConsole
        agents={agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          status: agent.status,
          rail: agent.rail,
        }))}
        merchants={options}
        csrf={session.csrf}
        initialAgentId={params.agent}
        initialMerchantId={params.merchant}
        initialServiceId={params.service}
        defaultOpen
      />

      <section className="card-solid overflow-hidden">
        <div className="border-b border-line bg-paper-deep/50 px-5 py-4">
          <div className="label">Reference</div>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">Endpoints</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
            All responses use an envelope:{" "}
            <code className="font-mono">{`{ "ok": true, "data": … }`}</code> or{" "}
            <code className="font-mono">{`{ "ok": false, "error": { "code", "message" } }`}</code>.
          </p>
        </div>

        <div className="divide-y divide-line">
          <div className="grid gap-4 px-5 py-5 md:grid-cols-[220px_1fr]">
            <div>
              <div className="flex items-center gap-2">
                <span className="badge border-green/30 bg-green-soft text-green">GET</span>
                <code className="font-mono text-[11px]">/v1/agent/budget</code>
              </div>
              <p className="mt-2 text-[11px] leading-4 text-muted">
                Remaining budget, committed and held amounts for the agent&apos;s policy.
              </p>
            </div>
            <Code>{`curl http://localhost:3000/v1/agent/budget \\
  -H "Authorization: Bearer $AGENTSPEND_TOKEN"`}</Code>
          </div>

          <div className="grid gap-4 px-5 py-5 md:grid-cols-[220px_1fr]">
            <div>
              <div className="flex items-center gap-2">
                <span className="badge border-green/30 bg-green-soft text-green">GET</span>
                <code className="font-mono text-[11px]">/v1/agent/policy</code>
              </div>
              <p className="mt-2 text-[11px] leading-4 text-muted">
                The exact policy version the agent is spending against, including enforcement
                layer.
              </p>
            </div>
            <Code>{`curl http://localhost:3000/v1/agent/policy \\
  -H "Authorization: Bearer $AGENTSPEND_TOKEN"`}</Code>
          </div>

          <div className="grid gap-4 px-5 py-5 md:grid-cols-[220px_1fr]">
            <div>
              <div className="flex items-center gap-2">
                <span className="badge border-amber/30 bg-amber-soft text-amber">POST</span>
                <code className="font-mono text-[11px]">/v1/agent/payment-requests</code>
              </div>
              <p className="mt-2 text-[11px] leading-4 text-muted">
                Ask for a payment. Send a service id to use the registered price, or an amount for
                a merchant without a service. The payout is never in the request.
              </p>
            </div>
            <Code>{`curl -X POST http://localhost:3000/v1/agent/payment-requests \\
  -H "Authorization: Bearer $AGENTSPEND_TOKEN" \\
  -H "Idempotency-Key: task-42-step-1" \\
  -H "Content-Type: application/json" \\
  -d '{
    "merchant_id": "merchant-compute",
    "service_id": "svc-compute-gpu"
  }'`}</Code>
          </div>

          <div className="grid gap-4 px-5 py-5 md:grid-cols-[220px_1fr]">
            <div>
              <div className="flex items-center gap-2">
                <span className="badge border-green/30 bg-green-soft text-green">GET</span>
                <code className="font-mono text-[11px]">
                  /v1/agent/payment-requests/&lt;id&gt;
                </code>
              </div>
              <p className="mt-2 text-[11px] leading-4 text-muted">
                Poll one payment. <code className="font-mono">fulfillment_allowed</code> is true
                only for verified settlement — never for unknown.
              </p>
            </div>
            <Code>{`curl http://localhost:3000/v1/agent/payment-requests/pay_… \\
  -H "Authorization: Bearer $AGENTSPEND_TOKEN"`}</Code>
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card-solid overflow-hidden">
          <div className="border-b border-line bg-paper-deep/50 px-5 py-4">
            <div className="label">Decision semantics</div>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
              What the statuses mean
            </h2>
          </div>
          <div className="px-5 py-4">
            <dl className="space-y-3 text-xs">
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-green">
                  succeeded
                </dt>
                <dd className="mt-0.5 leading-5 text-muted">
                  The rail verified the expected payout, asset, network and amount. The merchant
                  may fulfill.
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-amber">
                  awaiting_approval
                </dt>
                <dd className="mt-0.5 leading-5 text-muted">
                  Budget is reserved. A human must approve this exact payment before it can settle.
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-rust">
                  denied
                </dt>
                <dd className="mt-0.5 leading-5 text-muted">
                  A policy rule rejected it before any money moved. No fee, no reservation.
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-blue">
                  unknown
                </dt>
                <dd className="mt-0.5 leading-5 text-muted">
                  The rail cannot prove settlement. Treat as not paid; reconcile before retrying.
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-rust">
                  failed
                </dt>
                <dd className="mt-0.5 leading-5 text-muted">
                  The transfer was attempted and failed. No platform fee is charged.
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="card-solid overflow-hidden">
          <div className="border-b border-line bg-paper-deep/50 px-5 py-4">
            <div className="flex items-center gap-2">
              <Webhook className="h-4 w-4 text-muted" aria-hidden />
              <div>
                <div className="label">Merchants</div>
                <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
                  The other side of the rail
                </h2>
              </div>
            </div>
          </div>
          <div className="space-y-3 px-5 py-4 text-xs leading-5 text-muted">
            <p>
              Merchants can create a payment request for one of their services and receive a
              signed webhook when the payment settles. The merchant API uses its own bearer
              credential, separate from any agent.
            </p>
            <Code>{`curl -X POST http://localhost:3000/v1/merchant/payment-requests \\
  -H "Authorization: Bearer $MERCHANT_TOKEN" \\
  -H "Idempotency-Key: order-1001" \\
  -H "Content-Type: application/json" \\
  -d '{"service_id":"svc-data-market"}'`}</Code>
            <p>
              Webhook deliveries are disabled unless the destination host is explicitly allowed in{" "}
              <code className="font-mono">AGENTSPEND_WEBHOOK_HOSTS</code>. The test endpoint
              returns a signed sample without making an outbound call.
            </p>
            <Link
              href="/merchant/login"
              className="inline-flex items-center gap-1 text-ink underline underline-offset-2"
            >
              Open the merchant portal
              <ArrowUpRight className="h-3 w-3" aria-hidden />
            </Link>
          </div>
        </section>
      </div>

      <div className="flex items-start gap-2 border-t border-line pt-4 text-[10px] leading-5 text-muted">
        <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Credentials are shown once, stored as hashes, and never placed in URLs. Rotate from the
        Agents page if one is exposed.
      </div>
    </div>
  );
}
