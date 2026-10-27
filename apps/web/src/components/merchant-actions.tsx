"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  FlaskConical,
  Loader2,
  Plus,
  Send,
  Trash2,
  Webhook,
} from "lucide-react";
import { api, errorMessage, newIdempotencyKey } from "@/lib/client";
import { formatDateTime } from "@/lib/format";
import { CopyButton } from "@/components/actions";
import { Callout, StatusBadge } from "@/components/ui";
import { RelativeTime } from "@/components/relative-time";

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="flex items-start gap-2 rounded-lg border border-rust/25 bg-rust-soft/60 p-2.5 text-[11px] leading-4 text-rust">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

function SuccessNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="flex items-start gap-2 rounded-lg border border-green/25 bg-green-soft/60 p-2.5 text-[11px] leading-4 text-green">
      <Check className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

export function CreateServiceForm({ csrf }: { csrf: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const result = await api<{ service: { name: string } }>("/api/merchant/services", {
        method: "POST",
        csrf,
        body: { name, description, price },
      });
      setCreated(`${result.service.name} is live in the catalogue.`);
      setName("");
      setDescription("");
      setPrice("");
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1.2fr_1.4fr_0.7fr]">
        <label className="block">
          <span className="label">Service name</span>
          <input
            className="input mt-1.5 text-xs"
            value={name}
            onChange={(event) => setName(event.target.value)}
            minLength={2}
            maxLength={64}
            required
            placeholder="Priority queue"
          />
        </label>
        <label className="block">
          <span className="label">Description</span>
          <input
            className="input mt-1.5 text-xs"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={240}
            placeholder="What the agent receives"
          />
        </label>
        <label className="block">
          <span className="label">Price</span>
          <span className="mt-1.5 flex items-center gap-2 rounded-lg border border-line-strong bg-[#fffdf8] px-3 py-2 focus-within:border-ink">
            <span className="font-mono text-xs text-muted">$</span>
            <input
              className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              inputMode="decimal"
              required
              placeholder="5.00"
              aria-label="Price in dollars"
            />
          </span>
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] leading-4 text-muted">
          Prices are stored as integer base units with 6 decimals. The agent cannot override a
          registered service price.
        </p>
        <button
          type="submit"
          className="btn btn-primary !px-3 !py-1.5 !text-xs"
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Plus className="h-3.5 w-3.5" aria-hidden />
          )}
          Add service
        </button>
      </div>
      <ErrorNote message={error} />
      <SuccessNote message={created} />
    </form>
  );
}

interface CreatedRequest {
  id: string;
  amountUsd: string;
  requestExpiry: number;
  replayed: boolean;
}

export function RequestComposer({
  csrf,
  services,
}: {
  csrf: string;
  services: Array<{ id: string; name: string; priceUsd: string }>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedRequest | null>(null);

  async function create() {
    if (!serviceId) return;
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const result = await api<{ request: CreatedRequest; replayed: boolean }>(
        "/api/merchant/requests",
        {
          method: "POST",
          csrf,
          idempotencyKey: newIdempotencyKey("merchant-request"),
          body: { serviceId },
        },
      );
      setCreated({ ...result.request, replayed: result.replayed });
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[220px] flex-1">
          <span className="label">Service</span>
          <select
            className="input mt-1.5 !py-2 text-xs"
            value={serviceId}
            onChange={(event) => setServiceId(event.target.value)}
          >
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name} · {service.priceUsd}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-primary !px-3 !py-2 !text-xs"
          onClick={create}
          disabled={busy || !serviceId}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Send className="h-3.5 w-3.5" aria-hidden />
          )}
          Create payment request
        </button>
      </div>

      {created ? (
        <div className="rounded-lg border border-green/25 bg-green-soft/50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-green">
              {created.replayed ? "Replayed existing request" : "Request created"} ·{" "}
              {created.amountUsd}
            </span>
            <CopyButton value={created.id} label="Copy request id" />
          </div>
          <div className="mt-1 font-mono text-[10px] text-ink-soft">{created.id}</div>
          <p className="mt-1 text-[10px] text-muted">
            Expires {formatDateTime(created.requestExpiry)} UTC · share the id with an agent; the
            price is fixed by the catalogue.
          </p>
        </div>
      ) : null}
      <ErrorNote message={error} />
    </div>
  );
}

interface EndpointView {
  id: string;
  url: string;
  active: number;
  created_at: number;
}

interface DeliveryView {
  id: string;
  payment_id: string;
  event_type: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: number;
  delivered_at: number | null;
}

interface WebhookTestResult {
  eventId: string;
  eventType: string;
  payload: string;
  signatureHeader: string;
  deliverable: boolean;
  note: string;
}

export function WebhookPanel({
  csrf,
  endpoints,
  deliveries,
}: {
  csrf: string;
  endpoints: EndpointView[];
  deliveries: DeliveryView[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [test, setTest] = useState<WebhookTestResult | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError(null);
    setSecret(null);
    try {
      const result = await api<{ secret: string; warning: string }>(
        "/api/merchant/webhooks",
        { method: "POST", csrf, body: { url } },
      );
      setSecret(result.secret);
      setUrl("");
      refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function signSample() {
    setBusy("test");
    setError(null);
    setTest(null);
    try {
      const result = await api<WebhookTestResult>("/api/merchant/webhooks", {
        method: "PUT",
        csrf,
        body: url ? { url } : {},
      });
      setTest(result);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function deactivate(endpointId: string) {
    setBusy(endpointId);
    setError(null);
    setNote(null);
    try {
      await api("/api/merchant/webhooks", {
        method: "DELETE",
        csrf,
        body: { endpointId },
      });
      setNote("Endpoint deactivated. Queued deliveries will not be sent to it.");
      refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function dispatch() {
    setBusy("dispatch");
    setError(null);
    setNote(null);
    try {
      const result = await api<{ delivered: number; note: string }>(
        "/api/merchant/webhooks/dispatch",
        { method: "POST", csrf },
      );
      setNote(`${result.delivered} deliver${result.delivered === 1 ? "y" : "ies"} sent. ${result.note}`);
      refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={create} className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[260px] flex-1">
            <span className="label">Endpoint URL</span>
            <input
              className="input mt-1.5 font-mono text-xs"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              type="url"
              placeholder="https://merchant.example/webhooks/agentspend"
              required
            />
          </label>
          <button
            type="submit"
            className="btn btn-primary !px-3 !py-2 !text-xs"
            disabled={busy !== null}
          >
            {busy === "create" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Webhook className="h-3.5 w-3.5" aria-hidden />
            )}
            Register endpoint
          </button>
          <button
            type="button"
            className="btn btn-ghost !px-3 !py-2 !text-xs"
            onClick={signSample}
            disabled={busy !== null}
          >
            {busy === "test" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <FlaskConical className="h-3.5 w-3.5" aria-hidden />
            )}
            Sign a sample
          </button>
        </div>
        <p className="text-[10px] leading-4 text-muted">
          Outbound delivery is disabled unless the host appears in{" "}
          <code className="font-mono">AGENTSPEND_WEBHOOK_HOSTS</code>. Registering a URL outside
          that allowlist is rejected — the server never fetches an arbitrary URL.
        </p>
      </form>

      {secret ? (
        <div className="rounded-xl border border-amber/30 bg-amber-soft/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-amber">
              Signing secret · shown once
            </span>
            <CopyButton value={secret} label="Copy secret" />
          </div>
          <div className="mt-1 break-all font-mono text-[10px] text-ink-soft">{secret}</div>
        </div>
      ) : null}

      {test ? (
        <div className="rounded-xl border border-blue/25 bg-blue-soft/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-blue">
              {test.eventType} · {test.deliverable ? "host allowlisted" : "sample only"}
            </span>
            <CopyButton value={test.signatureHeader} label="Copy signature" />
          </div>
          <p className="mt-1 text-[10px] leading-4 text-muted">{test.note}</p>
          <div className="mt-2 rounded-lg border border-line bg-[#12130f] p-2.5">
            <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-paper/40">
              signature header
            </div>
            <div className="mt-1 break-all font-mono text-[10px] text-[#e8e7df]">
              {test.signatureHeader}
            </div>
          </div>
          <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-line bg-[#12130f] p-2.5 font-mono text-[10px] leading-4 text-[#e8e7df]">
            {test.payload}
          </pre>
        </div>
      ) : null}

      <ErrorNote message={error} />
      <SuccessNote message={note} />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="label">Endpoints</div>
          <button
            type="button"
            className="btn btn-ghost !px-2.5 !py-1.5 !text-[10px]"
            onClick={dispatch}
            disabled={busy !== null || deliveries.every((delivery) => delivery.status !== "pending")}
          >
            {busy === "dispatch" ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <ArrowRight className="h-3 w-3" aria-hidden />
            )}
            Dispatch pending
          </button>
        </div>
        {endpoints.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-strong bg-paper/60 p-3 text-[11px] leading-4 text-muted">
            No endpoints registered. The signing sample above works without one.
          </p>
        ) : (
          endpoints.map((endpoint) => (
            <div
              key={endpoint.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-paper/70 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate font-mono text-[10px] text-ink-soft">{endpoint.url}</div>
                <div className="text-[9px] text-muted">
                  registered <RelativeTime at={endpoint.created_at} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={endpoint.active ? "active" : "revoked"} />
                {endpoint.active ? (
                  <button
                    type="button"
                    className="btn btn-danger !px-2 !py-1 !text-[10px]"
                    onClick={() => deactivate(endpoint.id)}
                    disabled={busy !== null}
                  >
                    {busy === endpoint.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="h-3 w-3" aria-hidden />
                    )}
                    Deactivate
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <div className="label">Recent deliveries</div>
        {deliveries.length === 0 ? (
          <p className="text-[11px] text-muted">No webhook deliveries yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line">
            {deliveries.slice(0, 8).map((delivery) => (
              <div
                key={delivery.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 text-[10px] last:border-b-0"
              >
                <div className="min-w-0">
                  <span className="font-mono text-ink-soft">{delivery.event_type}</span>
                  <span className="ml-2 text-muted">
                    <RelativeTime at={delivery.created_at} />
                  </span>
                  {delivery.last_error ? (
                    <div className="truncate text-rust">{delivery.last_error}</div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted">attempts {delivery.attempts}</span>
                  <StatusBadge status={delivery.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function RequestIdChip({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-paper px-1.5 py-0.5 font-mono text-[9px] text-muted hover:text-ink"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(id);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
      aria-label={copied ? "Copied request id" : "Copy request id"}
    >
      {copied ? <Check className="h-2.5 w-2.5" aria-hidden /> : <Copy className="h-2.5 w-2.5" aria-hidden />}
      {id}
    </button>
  );
}

export function MerchantDemoNote() {
  return (
    <Callout tone="amber" title="Demo merchant session">
      This portal selects a seeded testnet merchant without a production login. The data, API
      credential and webhook signatures are real within the demo; merchant onboarding and KYB are
      not implemented.
    </Callout>
  );
}
