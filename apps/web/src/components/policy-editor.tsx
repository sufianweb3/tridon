"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Check,
  ChevronDown,
  Gauge,
  Loader2,
  Lock,
  Pause,
  Play,
  Save,
  ShieldCheck,
  Store,
  Trash2,
} from "lucide-react";
import type { PolicyView } from "@/lib/policies";
import { formatUsd, formatUnits, parseUnits } from "@agentspend/core";
import { api, errorMessage } from "@/lib/client";
import { Callout, StatusBadge } from "@/components/ui";
import { RelativeTime } from "@/components/relative-time";

export interface MerchantOption {
  id: string;
  name: string;
  category: string;
  payoutAccount: string;
  perTxLimit: string;
  windowLimit: string;
  windowSecs: number;
  allowlisted: boolean;
  requiresApproval: boolean;
}

interface RuleState extends Omit<MerchantOption, "perTxLimit" | "windowLimit"> {
  perTxLimit: string;
  windowLimit: string;
}

const WINDOWS = [
  { value: 0, label: "No window" },
  { value: 3_600, label: "1 hour" },
  { value: 86_400, label: "24 hours" },
  { value: 604_800, label: "7 days" },
  { value: 2_592_000, label: "30 days" },
];

function decimal(units: string): string {
  return formatUnits(BigInt(units));
}

function amountLabel(value: string): string {
  try {
    const units = parseUnits(value || "0");
    return formatUsd(units);
  } catch {
    return "—";
  }
}

function Field({
  label,
  hint,
  value,
  onChange,
  disabled,
  suffix = "TESTUSD",
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <span className="mt-2 flex items-center gap-2 rounded-xl border border-line-strong bg-[#fffdf8] px-3 py-2 focus-within:border-ink focus-within:shadow-[0_0_0_3px_rgba(216,255,62,0.35)]">
        <input
          className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none disabled:text-muted"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode="decimal"
          disabled={disabled}
          aria-label={label}
        />
        <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted">{suffix}</span>
      </span>
      {hint ? <span className="mt-1 block text-[10px] leading-4 text-muted">{hint}</span> : null}
    </label>
  );
}

export function PolicyEditor({
  policy,
  merchants,
  csrf,
}: {
  policy: PolicyView;
  merchants: MerchantOption[];
  csrf: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [name, setName] = useState(policy.name);
  const [totalBudget, setTotalBudget] = useState(decimal(policy.totalBudget));
  const [perTxLimit, setPerTxLimit] = useState(decimal(policy.perTxLimit));
  const [dailyLimit, setDailyLimit] = useState(decimal(policy.dailyLimit));
  const [weeklyLimit, setWeeklyLimit] = useState(decimal(policy.weeklyLimit));
  const [monthlyLimit, setMonthlyLimit] = useState(decimal(policy.monthlyLimit));
  const [unknownMode, setUnknownMode] = useState(policy.unknownMerchantMode);
  const [unknownCap, setUnknownCap] = useState(decimal(policy.unknownMerchantCap));
  const [approvalMode, setApprovalMode] = useState(policy.approvalMode);
  const [rules, setRules] = useState<RuleState[]>(() =>
    merchants.map((merchant) => ({
      ...merchant,
      perTxLimit: decimal(merchant.perTxLimit),
      windowLimit: decimal(merchant.windowLimit),
    })),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState("");
  const [showRevoke, setShowRevoke] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const revoked = policy.status === "revoked";
  const paused = policy.status === "paused";
  const allowlistedCount = rules.filter((rule) => rule.allowlisted).length;

  const summary = useMemo(() => {
    try {
      const budget = parseUnits(totalBudget || "0");
      const committed = BigInt(policy.usage.committed);
      return {
        budget,
        remaining: budget > committed ? budget - committed : 0n,
      };
    } catch {
      return { budget: 0n, remaining: 0n };
    }
  }, [totalBudget, policy.usage.committed]);

  function updateRule(id: string, patch: Partial<RuleState>) {
    setRules((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    );
  }

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy("save");
    setError(null);
    setSaved(null);
    try {
      const result = await api<{ version: number; txHash: string | null }>("/api/policy", {
        method: "PATCH",
        csrf,
        body: {
          name,
          totalBudget,
          perTxLimit,
          dailyLimit: dailyLimit || "0",
          weeklyLimit: weeklyLimit || "0",
          monthlyLimit: monthlyLimit || "0",
          unknownMerchantMode: unknownMode,
          unknownMerchantCap: unknownMode === "allow_with_cap" ? unknownCap || "0" : "0",
          approvalMode,
          rules: rules.map((rule) => ({
            merchantId: rule.id,
            allowlisted: rule.allowlisted,
            perTxLimit: rule.perTxLimit || "0",
            windowLimit: rule.windowLimit || "0",
            windowSecs: rule.windowSecs,
            requiresApproval: rule.requiresApproval,
          })),
        },
      });
      setSaved(
        result.txHash
          ? `Saved as v${result.version}. On-chain tx ${result.txHash.slice(0, 12)}…`
          : `Saved as v${result.version}. Mock rail: backend limits updated.`,
      );
      refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function togglePause() {
    setBusy("pause");
    setError(null);
    try {
      await api("/api/policy/pause", { method: "POST", csrf, body: { paused: !paused } });
      refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    setBusy("revoke");
    setError(null);
    try {
      await api("/api/policy/revoke", {
        method: "POST",
        csrf,
        body: { confirmation: confirmRevoke },
      });
      setShowRevoke(false);
      setConfirmRevoke("");
      refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-rust/25 bg-rust-soft/60 p-3 text-xs leading-5 text-rust">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </div>
      ) : null}
      {saved ? (
        <div className="flex items-start gap-2 rounded-xl border border-green/25 bg-green-soft/60 p-3 text-xs leading-5 text-green">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {saved}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={policy.status} />
          <span className="badge border-line-strong bg-paper text-ink-soft">v{policy.version}</span>
          <span className="text-[10px] text-muted">
            updated <RelativeTime at={policy.updatedAt} />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost !px-3 !py-1.5 !text-xs"
            onClick={togglePause}
            disabled={revoked || busy !== null}
          >
            {busy === "pause" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : paused ? (
              <Play className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Pause className="h-3.5 w-3.5" aria-hidden />
            )}
            {paused ? "Resume policy" : "Pause everything"}
          </button>
          <button
            type="button"
            className="btn btn-danger !px-3 !py-1.5 !text-xs"
            onClick={() => setShowRevoke((value) => !value)}
            disabled={revoked || busy !== null}
          >
            <Ban className="h-3.5 w-3.5" aria-hidden />
            Revoke policy
          </button>
        </div>
      </div>

      {paused ? (
        <Callout tone="amber" title="This policy is paused">
          The vault refuses every <code className="font-mono">pay</code> call while paused, even
          if an agent holds a valid key. Resume only when you intend to allow spending again.
        </Callout>
      ) : null}
      {revoked ? (
        <Callout tone="rust" title="This policy is revoked">
          Revocation is terminal. Agents may still hold credentials, but every payment is denied
          before any money moves.
        </Callout>
      ) : null}

      {showRevoke && !revoked ? (
        <div className="rounded-xl border border-rust/30 bg-rust-soft/40 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-rust">
            <Trash2 className="h-4 w-4" aria-hidden />
            Revoke this policy permanently
          </div>
          <p className="mt-1 text-xs leading-5 text-ink-soft">
            This pauses the vault on-chain, denies every future request, and cannot be undone.
            Type <code className="font-mono font-semibold">REVOKE</code> to confirm.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              className="input max-w-[220px] font-mono text-xs"
              value={confirmRevoke}
              onChange={(event) => setConfirmRevoke(event.target.value)}
              placeholder="REVOKE"
              aria-label="Type REVOKE to confirm"
            />
            <button
              type="button"
              className="btn btn-danger !px-3 !py-2 !text-xs"
              onClick={revoke}
              disabled={confirmRevoke !== "REVOKE" || busy !== null}
            >
              {busy === "revoke" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              )}
              Revoke forever
            </button>
            <button
              type="button"
              className="btn btn-ghost !px-3 !py-2 !text-xs"
              onClick={() => {
                setShowRevoke(false);
                setConfirmRevoke("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <form onSubmit={save} className="space-y-6">
        <section className="card-solid overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-paper-deep/50 px-5 py-4">
            <div>
              <div className="label">Budget envelope</div>
              <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
                The hard numbers
              </h2>
            </div>
            <div className="text-right">
              <div className="label">Remaining at this budget</div>
              <div className="mt-1 font-mono text-sm">{formatUsd(summary.remaining)}</div>
            </div>
          </div>
          <div className="grid gap-4 px-5 py-5 md:grid-cols-2 xl:grid-cols-3">
            <label className="block md:col-span-2 xl:col-span-1">
              <span className="label">Policy name</span>
              <input
                className="input mt-2"
                value={name}
                onChange={(event) => setName(event.target.value)}
                minLength={2}
                maxLength={64}
                required
                disabled={revoked}
              />
            </label>
            <Field
              label="Total budget"
              value={totalBudget}
              onChange={setTotalBudget}
              disabled={revoked}
              hint="Lifetime gross cap for this policy."
            />
            <Field
              label="Per payment"
              value={perTxLimit}
              onChange={setPerTxLimit}
              disabled={revoked}
              hint="Caps the merchant price, not the fee."
            />
            <Field
              label="Daily limit"
              value={dailyLimit}
              onChange={setDailyLimit}
              disabled={revoked}
              hint="0 disables the daily window."
            />
            <Field
              label="Weekly limit"
              value={weeklyLimit}
              onChange={setWeeklyLimit}
              disabled={revoked}
              hint="0 disables the weekly window."
            />
            <Field
              label="Monthly limit"
              value={monthlyLimit}
              onChange={setMonthlyLimit}
              disabled={revoked}
              hint="0 disables the monthly window."
            />
          </div>
          <div className="flex flex-wrap items-center gap-4 border-t border-line bg-paper-deep/30 px-5 py-3 text-[10px] text-muted">
            <span className="flex items-center gap-1.5">
              <Gauge className="h-3.5 w-3.5" aria-hidden />
              {formatUsd(BigInt(policy.usage.committed))} committed
            </span>
            <span className="flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5" aria-hidden />
              {formatUsd(BigInt(policy.usage.held))} held
            </span>
            <span>Fees are charged on top of gross and never on blocked payments.</span>
          </div>
        </section>

        <section className="card-solid overflow-hidden">
          <div className="border-b border-line bg-paper-deep/50 px-5 py-4">
            <div className="label">Unknown merchants</div>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
              What happens off the allowlist
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
              “Unknown” means not allowlisted on this policy. The payout account is always pinned
              in vault state; an agent can never supply a destination.
            </p>
          </div>
          <div className="grid gap-3 px-5 py-5 md:grid-cols-3">
            {(
              [
                {
                  value: "deny" as const,
                  title: "Deny",
                  body: "Reject any merchant that is not allowlisted.",
                  icon: Ban,
                },
                {
                  value: "require_approval" as const,
                  title: "Require approval",
                  body: "Hold the request until a human approves it.",
                  icon: ShieldCheck,
                },
                {
                  value: "allow_with_cap" as const,
                  title: "Allow under a cap",
                  body: "Pay unlisted merchants up to a fixed per-payment cap.",
                  icon: Gauge,
                },
              ] as const
            ).map((option) => {
              const Icon = option.icon;
              const selected = unknownMode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setUnknownMode(option.value)}
                  disabled={revoked}
                  className={`rounded-xl border p-4 text-left transition-colors ${
                    selected
                      ? "border-ink bg-lime/15"
                      : "border-line bg-paper/60 hover:border-line-strong"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <Icon className="h-4 w-4" aria-hidden />
                    <span
                      className={`grid h-4 w-4 place-items-center rounded-full border ${
                        selected ? "border-ink bg-ink text-paper" : "border-line-strong"
                      }`}
                    >
                      {selected ? <Check className="h-2.5 w-2.5" aria-hidden /> : null}
                    </span>
                  </div>
                  <div className="mt-2 text-sm font-semibold">{option.title}</div>
                  <p className="mt-1 text-[11px] leading-4 text-muted">{option.body}</p>
                </button>
              );
            })}
          </div>
          {unknownMode === "allow_with_cap" ? (
            <div className="border-t border-line px-5 py-4">
              <div className="max-w-xs">
                <Field
                  label="Unknown merchant cap"
                  value={unknownCap}
                  onChange={setUnknownCap}
                  disabled={revoked}
                  hint={`Maximum per payment: ${amountLabel(unknownCap)}`}
                />
              </div>
            </div>
          ) : null}
        </section>

        <section className="card-solid overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-paper-deep/50 px-5 py-4">
            <div>
              <div className="label">Human gate</div>
              <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
                When a person must approve
              </h2>
            </div>
            <select
              className="input max-w-xs !py-2 text-xs"
              value={approvalMode}
              onChange={(event) => setApprovalMode(event.target.value as PolicyView["approvalMode"])}
              disabled={revoked}
              aria-label="Approval mode"
            >
              <option value="none_within_policy">No approval while inside the policy</option>
              <option value="all">Every payment needs approval</option>
              <option value="selected_merchants">Selected merchants need approval</option>
              <option value="unknown_merchants">Unlisted merchants need approval</option>
            </select>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs leading-5 text-muted">
              Approval mode is enforced by the backend orchestrator and the vault&apos;s approval
              hash binding. A request that needs approval reserves budget but cannot settle until
              a human signs off.
            </p>
          </div>
        </section>

        <section className="card-solid overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-paper-deep/50 px-5 py-4">
            <div>
              <div className="label">Merchant rules</div>
              <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
                {allowlistedCount} allowlisted of {rules.length}
              </h2>
            </div>
            <span className="flex items-center gap-1.5 text-[10px] text-muted">
              <Store className="h-3.5 w-3.5" aria-hidden />
              Payouts are pinned and cannot be edited by an agent
            </span>
          </div>

          <div className="divide-y divide-line">
            {rules.map((rule) => {
              const open = expanded === rule.id;
              return (
                <div key={rule.id} className="bg-paper/40">
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() => setExpanded(open ? null : rule.id)}
                      aria-expanded={open}
                    >
                      <span
                        className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border ${
                          rule.allowlisted
                            ? "border-green/30 bg-green-soft text-green"
                            : "border-line-strong bg-paper-deep text-muted"
                        }`}
                      >
                        {rule.allowlisted ? (
                          <Check className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <Ban className="h-3.5 w-3.5" aria-hidden />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{rule.name}</span>
                        <span className="block truncate font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
                          {rule.category} · {rule.payoutAccount}
                        </span>
                      </span>
                    </button>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10px] text-muted">
                        {amountLabel(rule.perTxLimit) === "$0.00"
                          ? "policy max"
                          : `${amountLabel(rule.perTxLimit)} max`}
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={rule.allowlisted}
                        aria-label={`Allowlist ${rule.name}`}
                        onClick={() => updateRule(rule.id, { allowlisted: !rule.allowlisted })}
                        disabled={revoked}
                        className={`relative h-6 w-11 rounded-full border transition-colors ${
                          rule.allowlisted
                            ? "border-ink bg-ink"
                            : "border-line-strong bg-paper-deep"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 h-4 w-4 rounded-full bg-paper transition-[left] ${
                            rule.allowlisted ? "left-[22px]" : "left-0.5"
                          }`}
                        />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost !px-2 !py-1.5 !text-[10px]"
                        onClick={() => setExpanded(open ? null : rule.id)}
                        aria-label={`Edit ${rule.name}`}
                      >
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
                          aria-hidden
                        />
                      </button>
                    </div>
                  </div>

                  {open ? (
                    <div className="grid gap-4 border-t border-line/70 bg-paper-deep/25 px-4 py-4 md:grid-cols-4">
                      <Field
                        label="Merchant per-payment"
                        value={rule.perTxLimit}
                        onChange={(value) => updateRule(rule.id, { perTxLimit: value })}
                        disabled={revoked}
                        hint="0 falls back to the policy per-payment cap."
                      />
                      <Field
                        label="Window limit"
                        value={rule.windowLimit}
                        onChange={(value) => updateRule(rule.id, { windowLimit: value })}
                        disabled={revoked}
                        hint="0 disables the merchant window."
                      />
                      <label className="block">
                        <span className="label">Window</span>
                        <select
                          className="input mt-2 !py-2 text-xs"
                          value={rule.windowSecs}
                          onChange={(event) =>
                            updateRule(rule.id, { windowSecs: Number(event.target.value) })
                          }
                          disabled={revoked}
                        >
                          {WINDOWS.map((window) => (
                            <option key={window.value} value={window.value}>
                              {window.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex items-start gap-2 pt-5 text-xs">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 accent-[var(--color-ink)]"
                          checked={rule.requiresApproval}
                          onChange={(event) =>
                            updateRule(rule.id, { requiresApproval: event.target.checked })
                          }
                          disabled={revoked}
                        />
                        <span>
                          <span className="block font-medium">Requires approval</span>
                          <span className="block text-[10px] leading-4 text-muted">
                            Applies when approval mode is “selected merchants”.
                          </span>
                        </span>
                      </label>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line-strong bg-paper/95 px-4 py-3 shadow-[0_12px_40px_-16px_rgba(18,19,15,0.35)] backdrop-blur">
          <p className="max-w-md text-[10px] leading-4 text-muted">
            Saving writes the database first, then syncs the vault. If the chain sync fails the
            policy is paused immediately — it fails closed, never open.
          </p>
          <button
            type="submit"
            className="btn btn-primary !px-4 !py-2 !text-xs"
            disabled={revoked || busy !== null}
          >
            {busy === "save" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Save className="h-3.5 w-3.5" aria-hidden />
            )}
            Save policy
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </form>
    </div>
  );
}
