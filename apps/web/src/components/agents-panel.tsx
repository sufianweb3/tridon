"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  ShieldOff,
  X,
} from "lucide-react";
import type { AgentView } from "@/lib/agents";
import { formatUsd } from "@agentspend/core";
import { api, errorMessage } from "@/lib/client";
import { shortAccount } from "@/lib/format";
import { Progress, StatusBadge } from "@/components/ui";
import { CopyButton } from "@/components/actions";
import { RelativeTime } from "@/components/relative-time";

interface Issued {
  raw: string;
  prefix: string;
  id: string;
}

export function AgentsPanel({
  agents,
  csrf,
  rail,
}: {
  agents: AgentView[];
  csrf: string;
  rail: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ agentName: string; credential: Issued } | null>(null);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError(null);
    try {
      const result = await api<{
        agent: AgentView;
        credential: Issued;
        onChainKeyAdded: boolean;
      }>("/api/agents", {
        method: "POST",
        csrf,
        body: { name, description },
      });
      setIssued({ agentName: result.agent.name, credential: result.credential });
      setName("");
      setDescription("");
      setCreating(false);
      refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function rotate(agent: AgentView) {
    setBusy(`rotate:${agent.id}`);
    setError(null);
    try {
      const result = await api<{ credential: Issued }>(
        `/api/agents/${agent.id}/rotate`,
        { method: "POST", csrf },
      );
      setIssued({ agentName: agent.name, credential: result.credential });
      refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function revoke(agent: AgentView) {
    if (
      !window.confirm(
        `Revoke ${agent.name}? Its on-chain key is deleted first, then every pending payment is released. This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(`revoke:${agent.id}`);
    setError(null);
    try {
      await api(`/api/agents/${agent.id}/revoke`, { method: "POST", csrf });
      refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {issued ? (
        <div className="rounded-2xl border border-lime-deep/60 bg-lime/20 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="label !text-moss/70">Credential issued · shown once</div>
              <h2 className="mt-1 text-lg font-semibold tracking-[-0.02em]">
                {issued.agentName}
              </h2>
            </div>
            <button
              type="button"
              className="btn btn-ghost !px-2.5 !py-1.5 !text-xs"
              onClick={() => setIssued(null)}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Dismiss
            </button>
          </div>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-moss/80">
            Copy this bearer token now. Only a hash is stored, so it cannot be shown again.
            Rotating the credential revokes the previous token immediately.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-moss/20 bg-paper/80 px-3 py-2 font-mono text-[11px]">
              {issued.credential.raw}
            </code>
            <CopyButton value={issued.credential.raw} label="Copy bearer token" />
          </div>
          <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.1em] text-moss/60">
            prefix {issued.credential.prefix} · credential {issued.credential.id}
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-rust/25 bg-rust-soft/60 p-3 text-xs leading-5 text-rust">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs leading-5 text-muted">
          Each agent is a distinct signing identity. One vault policy governs all of them, so
          agents share the budget but never share a key.
        </p>
        <button
          type="button"
          className="btn btn-primary !px-4 !py-2 !text-xs"
          onClick={() => setCreating((value) => !value)}
        >
          {creating ? <X className="h-3.5 w-3.5" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />}
          {creating ? "Close form" : "New agent"}
        </button>
      </div>

      {rail !== "testnet" ? (
        <div className="rounded-xl border border-blue/20 bg-blue-soft/50 p-3 text-xs leading-5 text-blue">
          This workspace uses the mock rail. A new agent gets a bearer credential, but no
          on-chain key is created; limits are enforced by this backend only.
        </div>
      ) : null}

      {creating ? (
        <form onSubmit={create} className="card-solid space-y-3 p-5">
          <div>
            <label className="label" htmlFor="agent-name">
              Agent name
            </label>
            <input
              id="agent-name"
              className="input mt-2"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="research-agent"
              minLength={2}
              maxLength={64}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="agent-description">
              What it does
            </label>
            <input
              id="agent-description"
              className="input mt-2"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Fetches datasets and GPU minutes for a research loop."
              maxLength={240}
            />
          </div>
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-[10px] leading-4 text-muted">
              On a live vault, the server adds a function-call key scoped to{" "}
              <code className="font-mono">pay</code>. It cannot withdraw.
            </p>
            <button
              type="submit"
              className="btn btn-primary !px-4 !py-2 !text-xs"
              disabled={busy === "create"}
            >
              {busy === "create" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              )}
              Create agent
            </button>
          </div>
        </form>
      ) : null}

      <div className="grid gap-4">
        {agents.map((agent) => (
          <section key={agent.id} className="card-solid overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line bg-paper-deep/40 px-5 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold tracking-[-0.03em]">{agent.name}</h2>
                  <StatusBadge status={agent.status} />
                  {agent.rail ? (
                    <span className="badge border-line-strong bg-paper text-muted">
                      {agent.status === "revoked"
                        ? "key deleted"
                        : agent.rail === "testnet"
                          ? "on-chain key"
                          : "mock rail"}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs leading-5 text-muted">
                  {agent.description ?? "No description"}
                </p>
                <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
                  {agent.id} · created <RelativeTime at={agent.createdAt} />
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/integrations?agent=${agent.id}`}
                  className="btn btn-ghost !px-3 !py-1.5 !text-xs"
                >
                  Test payment
                </Link>
                <button
                  type="button"
                  className="btn btn-ghost !px-3 !py-1.5 !text-xs"
                  onClick={() => rotate(agent)}
                  disabled={agent.status !== "active" || busy !== null}
                >
                  {busy === `rotate:${agent.id}` ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Rotate token
                </button>
                <button
                  type="button"
                  className="btn btn-danger !px-3 !py-1.5 !text-xs"
                  onClick={() => revoke(agent)}
                  disabled={agent.status !== "active" || busy !== null}
                >
                  {busy === `revoke:${agent.id}` ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <ShieldOff className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Revoke
                </button>
              </div>
            </div>

            <div className="grid gap-5 px-5 py-4 md:grid-cols-[1fr_1fr]">
              <div>
                <div className="label">Budget</div>
                {agent.budget ? (
                  <>
                    <div className="mt-2 flex items-end justify-between gap-3">
                      <div className="font-serif text-3xl leading-none">
                        {formatUsd(BigInt(agent.budget.remaining))}
                      </div>
                      <div className="text-right font-mono text-[10px] text-muted">
                        of {formatUsd(BigInt(agent.budget.totalBudget))}
                      </div>
                    </div>
                    <Progress
                      part={BigInt(agent.budget.committed) + BigInt(agent.budget.held)}
                      total={BigInt(agent.budget.totalBudget)}
                      tone="lime"
                      className="mt-3"
                    />
                    <div className="mt-2 flex flex-wrap justify-between gap-2 text-[10px] text-muted">
                      <span>
                        {formatUsd(BigInt(agent.budget.committed))} committed ·{" "}
                        {formatUsd(BigInt(agent.budget.held))} held
                      </span>
                      <span>v{agent.budget.policyVersion}</span>
                    </div>
                  </>
                ) : (
                  <p className="mt-2 text-xs text-muted">No policy attached.</p>
                )}
              </div>

              <div>
                <div className="label">Signing identity</div>
                <div className="mt-2 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted">Public key</span>
                    <span className="truncate font-mono text-[10px]">
                      {agent.publicKey ? shortAccount(agent.publicKey, 14, 8) : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted">Scope</span>
                    <span className="font-mono text-[10px]">
                      {agent.rail === "testnet" ? "pay() only" : "backend token"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted">Credentials</span>
                    <span className="font-mono text-[10px]">
                      {agent.credentials.filter((credential) => !credential.revoked_at).length} active
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted">Last used</span>
                    <span className="font-mono text-[10px]">
                      {agent.credentials[0]?.last_used_at ? (
                        <RelativeTime at={agent.credentials[0].last_used_at} />
                      ) : (
                        "never"
                      )}
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {agent.credentials.slice(0, 4).map((credential) => (
                    <span
                      key={credential.id}
                      className={`badge ${
                        credential.revoked_at
                          ? "border-line bg-paper-deep text-muted line-through"
                          : "border-green/25 bg-green-soft/60 text-green"
                      }`}
                    >
                      <KeyRound className="h-2.5 w-2.5" aria-hidden />
                      {credential.prefix}
                    </span>
                  ))}
                  {agent.credentials.length === 0 ? (
                    <span className="text-[10px] text-muted">No credentials issued.</span>
                  ) : null}
                </div>
              </div>
            </div>

            {agent.status === "revoked" ? (
              <div className="border-t border-line bg-rust-soft/30 px-5 py-2.5 text-[10px] text-rust">
                Revoked <RelativeTime at={agent.revokedAt} />. The on-chain key was deleted before this
                record changed, so the agent cannot sign a new payment.
              </div>
            ) : null}
          </section>
        ))}

        {agents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line-strong bg-paper/60 p-8 text-center">
            <KeyRound className="mx-auto h-6 w-6 text-muted" aria-hidden />
            <h2 className="mt-3 text-sm font-semibold">No agents yet</h2>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted">
              An agent is a scoped signing identity, not a second wallet. It shares the vault
              budget and can only call the payment method.
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-line bg-paper-deep/50 p-3 text-[10px] leading-5 text-muted">
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green" aria-hidden />
        Rotating a bearer token does not create a new on-chain key. Revoking the agent deletes
        the on-chain function-call key first and then expires every pending payment.
      </div>
    </div>
  );
}
