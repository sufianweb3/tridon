"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, ServerCog } from "lucide-react";
import { api, errorMessage } from "@/lib/client";

interface AgentStatus {
  ok: boolean;
  function?: string;
  checkedAt?: string;
  agent?: {
    id: string;
    name: string;
    status: string;
    rail: string | null;
    vaultAccount: string | null;
    balance: string | null;
  };
  policy?: {
    version: number | null;
    totalBudget: string | null;
    perTxLimit: string | null;
  } | null;
  payments?: Record<string, { count: number; gross: string }>;
  note?: string;
}

export function NeonFunctionCheck() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AgentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ agentId: string; status: AgentStatus }>(
        "/api/neon/function-status",
        { method: "POST" },
      );
      setResult(data.status);
    } catch (caught) {
      setError(errorMessage(caught));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card-solid p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl border border-line-strong bg-paper-deep">
            <ServerCog className="h-4 w-4 text-muted" aria-hidden />
          </div>
          <div>
            <div className="label">Neon Functions</div>
            <h2 className="mt-1 text-base font-semibold tracking-[-0.02em]">
              Ask the deployed function, not this server
            </h2>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted">
              A server-to-server call runs in Neon, next to Postgres, and returns this
              workspace&apos;s agent status. The shared secret stays on the server.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={check}
          disabled={busy}
          className="btn btn-ghost !px-3 !py-2 !text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <ServerCog className="h-3.5 w-3.5" aria-hidden />
          )}
          Query function
        </button>
      </div>

      {error ? (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-rust/25 bg-rust-soft/60 p-3 text-xs leading-5 text-rust">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      {result?.agent ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-line bg-paper/70 p-3">
            <div className="label">Agent</div>
            <div className="mt-1.5 text-sm font-medium">{result.agent.name}</div>
            <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
              {result.agent.status} · {result.agent.rail ?? "no rail"}
            </div>
          </div>
          <div className="rounded-xl border border-line bg-paper/70 p-3">
            <div className="label">Policy</div>
            <div className="mt-1.5 text-sm font-medium">
              {result.policy ? `v${result.policy.version ?? "?"}` : "none"}
            </div>
            <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
              {result.policy?.perTxLimit
                ? `per-tx ${result.policy.perTxLimit} base units`
                : "no per-tx limit"}
            </div>
          </div>
          <div className="rounded-xl border border-line bg-paper/70 p-3">
            <div className="label">Payments seen</div>
            <div className="mt-1.5 text-sm font-medium">
              {Object.values(result.payments ?? {}).reduce(
                (sum, entry) => sum + entry.count,
                0,
              )}
            </div>
            <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
              {result.payments?.succeeded?.count ?? 0} succeeded
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-green sm:col-span-3">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            Answered by {result.function ?? "Neon Functions"} at{" "}
            {result.checkedAt ? new Date(result.checkedAt).toISOString() : "an unknown time"}
          </div>
        </div>
      ) : null}
    </section>
  );
}
