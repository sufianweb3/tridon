"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clock3,
  Copy,
  ExternalLink,
  FlaskConical,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Terminal,
  X,
} from "lucide-react";
import { formatUsd } from "@agentspend/core";
import { api, errorMessage, newIdempotencyKey } from "@/lib/client";
import { shortHash } from "@/lib/format";
import { CopyButton } from "@/components/actions";
import { Callout, StatusBadge } from "@/components/ui";
import { RelativeTime } from "@/components/relative-time";

interface AgentOption {
  id: string;
  name: string;
  status: string;
  rail: string | null;
}

interface ServiceOption {
  id: string;
  name: string;
  price: string;
}

interface MerchantOption {
  id: string;
  name: string;
  category: string;
  allowlisted: boolean;
  services: ServiceOption[];
}

interface PaymentResult {
  id: string;
  status: string;
  decision: string | null;
  denyCode: string | null;
  denyMessage: string | null;
  gross: string;
  grossUsd: string;
  userFeeUsd: string;
  merchantFeeUsd: string;
  netUsd: string;
  rail: string;
  railLabel: string;
  enforcement: string;
  txHash: string | null;
  explorerUrl: string | null;
  chainStatus: string | null;
  error: string | null;
  merchant: { id: string; name: string } | null;
  agent: { id: string; name: string } | null;
  createdAt: number;
}

interface ConsoleResponse {
  payment: PaymentResult;
  approval: {
    id: string;
    status: string;
    approvalHash: string;
    expiresAt: number;
  } | null;
  replayed: boolean;
  idempotencyKey: string;
}

const SCENARIOS = [
  {
    key: "allowed",
    label: "Allowed payment",
    detail: "Northstar GPU minute · $3.50",
    merchantId: "merchant-compute",
    serviceId: "svc-compute-gpu",
    tone: "lime" as const,
  },
  {
    key: "approval",
    label: "Needs approval",
    detail: "Lighthouse research brief · $24.00",
    merchantId: "merchant-research",
    serviceId: "svc-research-brief",
    tone: "amber" as const,
  },
  {
    key: "unknown",
    label: "Unlisted merchant",
    detail: "Atlas Data Co. · $4.50",
    merchantId: "merchant-atlas",
    serviceId: "svc-atlas-feed",
    tone: "blue" as const,
  },
  {
    key: "failure",
    label: "Settlement failure",
    detail: "Flaky Fulfillment · $1.00",
    merchantId: "merchant-fail",
    serviceId: "svc-fail-test",
    tone: "rust" as const,
  },
];

export function AgentConsole({
  agents,
  merchants,
  csrf,
  initialAgentId,
  initialMerchantId,
  initialServiceId,
  defaultOpen,
}: {
  agents: AgentOption[];
  merchants: MerchantOption[];
  csrf: string;
  initialAgentId?: string;
  initialMerchantId?: string;
  initialServiceId?: string;
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const activeAgents = agents.filter((agent) => agent.status === "active");
  const [agentId, setAgentId] = useState(
    initialAgentId ?? activeAgents[0]?.id ?? agents[0]?.id ?? "",
  );
  const [merchantId, setMerchantId] = useState(
    initialMerchantId ?? merchants[0]?.id ?? "",
  );
  const initialMerchant = merchants.find((merchant) => merchant.id === merchantId);
  const [serviceId, setServiceId] = useState(
    initialServiceId ?? initialMerchant?.services[0]?.id ?? "",
  );
  const [customAmount, setCustomAmount] = useState("");
  const [reuseKey, setReuseKey] = useState(false);
  // Generate the preview key after hydration: a random value during SSR would
  // not match the client render and would force React to discard the tree.
  const [idempotencyKey, setIdempotencyKey] = useState("console-preview");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConsoleResponse | null>(null);

  useEffect(() => {
    setIdempotencyKey(newIdempotencyKey("console"));
  }, []);

  const merchant = useMemo(
    () => merchants.find((item) => item.id === merchantId) ?? null,
    [merchantId, merchants],
  );
  const service = useMemo(
    () => merchant?.services.find((item) => item.id === serviceId) ?? null,
    [merchant, serviceId],
  );

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function send(overrides?: {
    merchantId?: string;
    serviceId?: string;
    label?: string;
  }) {
    const selectedAgent = agentId;
    if (!selectedAgent) {
      setError("Create an agent first. The console needs a signing identity.");
      return;
    }
    const targetMerchant = overrides?.merchantId ?? merchantId;
    const targetService = overrides?.serviceId ?? serviceId;
    setBusy(overrides?.label ?? "send");
    setError(null);
    setResult(null);
    try {
      const response = await api<ConsoleResponse>("/api/demo/agent-payment", {
        method: "POST",
        csrf,
        body: {
          agentId: selectedAgent,
          merchantId: targetMerchant,
          serviceId: targetService || undefined,
          amount: targetService ? undefined : customAmount || undefined,
          idempotencyKey: reuseKey ? idempotencyKey : undefined,
        },
      });
      setResult(response);
      setIdempotencyKey(response.idempotencyKey);
      refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  const equivalentCurl = `curl -X POST http://localhost:3000/v1/agent/payment-requests \\
  -H "Authorization: Bearer $AGENTSPEND_TOKEN" \\
  -H "Idempotency-Key: ${idempotencyKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"merchant_id":"${merchantId}","service_id":"${serviceId || "…"}"}'`;

  return (
    <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
      <div className="space-y-5">
        <section className="card-solid overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-paper-deep/50 px-5 py-4">
            <div>
              <div className="label">Agent console</div>
              <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
                Ask the policy for money
              </h2>
            </div>
            <span className="badge border-blue/25 bg-blue-soft text-blue">
              <FlaskConical className="h-3 w-3" aria-hidden />
              demo shortcut
            </span>
          </div>

          <div className="space-y-4 px-5 py-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="label">Signing agent</span>
                <select
                  className="input mt-2 !py-2 text-xs"
                  value={agentId}
                  onChange={(event) => setAgentId(event.target.value)}
                >
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id} disabled={agent.status !== "active"}>
                      {agent.name} · {agent.status}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">Merchant</span>
                <select
                  className="input mt-2 !py-2 text-xs"
                  value={merchantId}
                  onChange={(event) => {
                    setMerchantId(event.target.value);
                    const next = merchants.find((item) => item.id === event.target.value);
                    setServiceId(next?.services[0]?.id ?? "");
                  }}
                >
                  {merchants.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.allowlisted ? "" : " · unlisted"}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="label">Service</span>
              <select
                className="input mt-2 !py-2 text-xs"
                value={serviceId}
                onChange={(event) => setServiceId(event.target.value)}
              >
                <option value="">Custom amount</option>
                {(merchant?.services ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {formatUsd(BigInt(item.price))}
                  </option>
                ))}
              </select>
            </label>

            {serviceId === "" ? (
              <label className="block">
                <span className="label">Amount</span>
                <input
                  className="input mt-2 font-mono text-sm"
                  value={customAmount}
                  onChange={(event) => setCustomAmount(event.target.value)}
                  placeholder="1.00"
                  inputMode="decimal"
                />
                <span className="mt-1 block text-[10px] text-muted">
                  Custom amounts only work for merchants without a registered service price.
                </span>
              </label>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-paper/70 px-3 py-2.5">
                <div>
                  <div className="label">Gross amount</div>
                  <div className="mt-1 font-mono text-sm">
                    {service ? formatUsd(BigInt(service.price)) : "—"}
                  </div>
                </div>
                <div className="text-right text-[10px] leading-4 text-muted">
                  The agent cannot choose the price
                  <br />
                  when a service is registered.
                </div>
              </div>
            )}

            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[var(--color-ink)]"
                checked={reuseKey}
                onChange={(event) => setReuseKey(event.target.checked)}
              />
              <span>
                <span className="block font-medium">Replay the same idempotency key</span>
                <span className="block text-[10px] leading-4 text-muted">
                  A second identical request returns the original payment instead of charging
                  twice.
                </span>
              </span>
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <p className="max-w-[230px] text-[10px] leading-4 text-muted">
                This shortcut uses your signed-in session. Production agents call{" "}
                <code className="font-mono">/v1/agent/payment-requests</code> with a bearer
                credential.
              </p>
              <button
                type="button"
                className="btn btn-primary !px-4 !py-2 !text-xs"
                onClick={() => send()}
                disabled={busy !== null || agents.length === 0}
              >
                {busy === "send" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                )}
                Send payment request
              </button>
            </div>
          </div>
        </section>

        <section className="card-solid overflow-hidden">
          <div className="border-b border-line bg-paper-deep/50 px-5 py-4">
            <div className="label">One-click scenarios</div>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
              Exercise every branch
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted">
              Each button creates a fresh payment with a new idempotency key. The result panel
              shows exactly what the policy decided.
            </p>
          </div>
          <div className="grid gap-2 px-5 py-4 sm:grid-cols-2">
            {SCENARIOS.map((scenario) => (
              <button
                key={scenario.key}
                type="button"
                onClick={() =>
                  send({
                    merchantId: scenario.merchantId,
                    serviceId: scenario.serviceId,
                    label: scenario.key,
                  })
                }
                disabled={busy !== null || agents.length === 0}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-paper/60 px-3 py-3 text-left transition-colors hover:border-line-strong hover:bg-paper disabled:opacity-60"
              >
                <span className="min-w-0">
                  <span className="block text-xs font-semibold">{scenario.label}</span>
                  <span className="block truncate text-[10px] text-muted">{scenario.detail}</span>
                </span>
                {busy === scenario.key ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                ) : (
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                )}
              </button>
            ))}
          </div>
        </section>

        <section className="card-solid overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-line bg-paper-deep/50 px-5 py-4">
            <div>
              <div className="label">Equivalent call</div>
              <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
                The real agent API
              </h2>
            </div>
            <CopyButton value={equivalentCurl} label="Copy curl" />
          </div>
          <pre className="overflow-x-auto px-5 py-4 font-mono text-[10px] leading-5 text-ink-soft">
            {equivalentCurl}
          </pre>
        </section>
      </div>

      <div className="space-y-5">
        {error ? (
          <div className="flex items-start gap-2 rounded-xl border border-rust/25 bg-rust-soft/60 p-3 text-xs leading-5 text-rust">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {error}
          </div>
        ) : null}

        {!result ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-paper/60 p-8 text-center">
            <Terminal className="h-6 w-6 text-muted" aria-hidden />
            <h2 className="mt-3 text-sm font-semibold">No request sent yet</h2>
            <p className="mt-1 max-w-sm text-xs leading-5 text-muted">
              Send a payment or run a scenario. The decision, fee state and settlement proof will
              appear here.
            </p>
          </div>
        ) : (
          <>
            <section className="card-solid overflow-hidden">
              <div
                className={`flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4 ${
                  result.payment.status === "succeeded"
                    ? "border-green/20 bg-green-soft/30"
                    : result.payment.status === "awaiting_approval"
                      ? "border-amber/20 bg-amber-soft/25"
                      : result.payment.status === "denied" ||
                          result.payment.status === "failed"
                        ? "border-rust/20 bg-rust-soft/25"
                        : "border-line bg-paper-deep/40"
                }`}
              >
                <div>
                  <div className="label">Response</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <StatusBadge status={result.payment.status} />
                    {result.replayed ? (
                      <span className="badge border-blue/25 bg-blue-soft text-blue">
                        <RotateCcw className="h-3 w-3" aria-hidden />
                        idempotent replay
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="text-right">
                  <div className="label">Gross</div>
                  <div className="mt-1 font-serif text-3xl leading-none">
                    {result.payment.grossUsd}
                  </div>
                </div>
              </div>

              <div className="px-5 py-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-line bg-paper/70 p-3">
                    <div className="label">Decision</div>
                    <div className="mt-1 text-sm font-medium">
                      {result.payment.decision ?? "—"}
                      {result.payment.denyCode ? (
                        <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.08em] text-rust">
                          {result.payment.denyCode.replaceAll("_", " ")}
                        </span>
                      ) : null}
                    </div>
                    {result.payment.denyMessage ? (
                      <p className="mt-1 text-[10px] leading-4 text-muted">
                        {result.payment.denyMessage}
                      </p>
                    ) : null}
                  </div>
                  <div className="rounded-xl border border-line bg-paper/70 p-3">
                    <div className="label">Enforcement</div>
                    <div className="mt-1 text-xs leading-5">{result.payment.enforcement}</div>
                  </div>
                </div>

                {result.payment.status === "succeeded" ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border border-line bg-paper/60 p-2.5">
                      <div className="label">Merchant gets</div>
                      <div className="mt-1 font-mono text-xs">{result.payment.netUsd}</div>
                    </div>
                    <div className="rounded-lg border border-line bg-paper/60 p-2.5">
                      <div className="label">User fee</div>
                      <div className="mt-1 font-mono text-xs">{result.payment.userFeeUsd}</div>
                    </div>
                    <div className="rounded-lg border border-line bg-paper/60 p-2.5">
                      <div className="label">Merchant fee</div>
                      <div className="mt-1 font-mono text-xs">{result.payment.merchantFeeUsd}</div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-line bg-paper-deep/40 p-2.5 text-[10px] leading-4 text-muted">
                    No fee was charged. Any reserved budget is released or held for the approval,
                    never silently spent.
                  </div>
                )}

                {result.approval ? (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber/25 bg-amber-soft/40 p-3">
                    <div className="flex items-center gap-2 text-xs text-amber">
                      <Clock3 className="h-3.5 w-3.5" aria-hidden />
                      Approval {result.approval.status} · expires{" "}
                      <RelativeTime at={result.approval.expiresAt} />
                    </div>
                    <Link
                      href="/approvals"
                      className="btn btn-ghost !px-3 !py-1.5 !text-[10px]"
                    >
                      Open approvals
                      <ArrowRight className="h-3 w-3" aria-hidden />
                    </Link>
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3 text-[10px] text-muted">
                  <Link
                    href={`/transactions/${result.payment.id}`}
                    className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-ink"
                  >
                    Open payment {shortHash(result.payment.id)}
                  </Link>
                  {result.payment.explorerUrl ? (
                    <a
                      href={result.payment.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-ink"
                    >
                      Explorer
                      <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  ) : null}
                  <span className="font-mono">key {result.idempotencyKey}</span>
                </div>
              </div>
            </section>

            <section className="card-solid overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-line bg-paper-deep/50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Terminal className="h-3.5 w-3.5 text-muted" aria-hidden />
                  <span className="label !text-ink-soft">Raw response</span>
                </div>
                <CopyButton value={JSON.stringify(result, null, 2)} label="Copy JSON" />
              </div>
              <pre className="max-h-[380px] overflow-auto px-4 py-3 font-mono text-[10px] leading-5 text-ink-soft">
                {JSON.stringify(result, null, 2)}
              </pre>
            </section>
          </>
        )}

        <Callout tone="paper" title="What this console does not do">
          It cannot raise a limit, approve a request, or choose a payout account. It only asks the
          same question an agent asks, and shows the answer the policy engine produced.
        </Callout>
      </div>
    </div>
  );
}
