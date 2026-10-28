import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  FileCode2,
  Fingerprint,
  Landmark,
  Lock,
  ServerCog,
  ShieldCheck,
} from "lucide-react";
import { requireUserPage } from "@/lib/server-auth";
import { vaultForUser } from "@/lib/platform";
import { policyForUser } from "@/lib/policies";
import { appConfig, explorerAccount } from "@/lib/config";
import { shortAccount } from "@/lib/format";
import { Callout, PageHeader, RailBadge, TokenChip } from "@/components/ui";

export const metadata = { title: "Security model" };
export const dynamic = "force-dynamic";

const MATRIX: Array<{
  control: string;
  chain: string;
  backend: string;
  compromise: string;
}> = [
  {
    control: "Total budget",
    chain: "Yes — vault state",
    backend: "Mirror for fast denial",
    compromise: "Cannot exceed the on-chain cap",
  },
  {
    control: "Per-payment limit",
    chain: "Yes — checked before transfer",
    backend: "Mirror",
    compromise: "Cannot exceed the on-chain cap",
  },
  {
    control: "Daily / weekly / monthly caps",
    chain: "Yes — UTC day buckets",
    backend: "Mirror",
    compromise: "Cannot exceed the on-chain caps",
  },
  {
    control: "Merchant allowlist",
    chain: "Yes — per-merchant rule",
    backend: "Mirror",
    compromise: "Cannot pay a non-allowlisted merchant outside the unknown rule",
  },
  {
    control: "Merchant payout account",
    chain: "Yes — pinned at registration",
    backend: "Reads the pinned value",
    compromise: "Cannot redirect funds; there is no payout parameter",
  },
  {
    control: "Per-merchant window cap",
    chain: "Yes — rolling seconds",
    backend: "Mirror",
    compromise: "Cannot exceed the on-chain window",
  },
  {
    control: "Unknown-merchant mode",
    chain: "Yes — deny / approval / capped",
    backend: "Mirror",
    compromise: "Cannot bypass a denial; can still request approval",
  },
  {
    control: "Approval gate",
    chain: "Yes — approval hash bound to payment",
    backend: "Queue, notify, sign approval",
    compromise: "Cannot skip an on-chain-required approval",
  },
  {
    control: "Agent active / revoked",
    chain: "Yes — function-call key deleted",
    backend: "Mirror",
    compromise: "A revoked key cannot sign at all",
  },
  {
    control: "Pause / revoke policy",
    chain: "Yes — vault pause flag",
    backend: "Mirror",
    compromise: "Cannot resume or un-revoke",
  },
  {
    control: "Policy expiry",
    chain: "Yes — timestamps in state",
    backend: "Mirror",
    compromise: "Cannot extend",
  },
  {
    control: "Fee amounts",
    chain: "Yes — computed on-chain",
    backend: "Displayed",
    compromise: "Cannot overcharge or invent a fee",
  },
  {
    control: "No fee on failure",
    chain: "Yes — fee transfer chained after merchant success",
    backend: "Ledger check",
    compromise: "Structurally impossible to charge on failure",
  },
  {
    control: "Payment idempotency",
    chain: "Yes — permanent payment marker",
    backend: "Idempotency-Key",
    compromise: "Cannot double-charge with the same payment id",
  },
  {
    control: "Service / price matches catalogue",
    chain: "No",
    backend: "Yes — service id and registered price",
    compromise: "Can overpay an allowlisted merchant, but only inside the caps",
  },
  {
    control: "Rate limiting / abuse",
    chain: "No",
    backend: "Yes — single-process limiter",
    compromise: "Lost; a multi-instance deployment needs a shared limiter",
  },
  {
    control: "Settlement verification",
    chain: "Chain data is public",
    backend: "Verifies FINAL receipt + exact NEP-141 event",
    compromise: "Can lie to itself, but cannot forge a FINAL receipt",
  },
  {
    control: "Credential hashing",
    chain: "N/A",
    backend: "SHA-256 at rest, shown once",
    compromise: "Secrets exposed if the process is compromised",
  },
];

const THREATS: Array<{ id: string; title: string; body: string }> = [
  {
    id: "T1",
    title: "Agent key stolen",
    body: "The key is scoped to pay() on one vault. The attacker can spend only inside the on-chain policy, and rotating the agent deletes the key. Revocation is authoritative when the DeleteKey receipt is FINAL.",
  },
  {
    id: "T3",
    title: "Backend compromised",
    body: "The backend holds no owner key for a real user vault. It can cause payments the policy already permits, to merchants already pinned, inside the user's caps. It cannot withdraw, raise a limit, or redirect a payout.",
  },
  {
    id: "T5",
    title: "Replay or duplicate payment",
    body: "The contract stores a permanent marker per payment id; the API requires an Idempotency-Key. Replaying the key returns the original payment instead of charging twice.",
  },
  {
    id: "T6",
    title: "Concurrent overspend",
    body: "NEAR serializes contract state per account. The backend serializes reservations with BEGIN IMMEDIATE in SQLite, so two requests cannot both reserve the last unit of budget.",
  },
  {
    id: "T7",
    title: "Submitted but not settled",
    body: "A broadcast transaction is not a payment. The rail reads the vault payment record and matches the exact merchant ft_transfer event. Unknown stays unknown and never permits fulfillment.",
  },
  {
    id: "T10",
    title: "Merchant not storage-registered",
    body: "The token transfer fails, the vault records Failed, the reservation is released and no fee is charged. Flaky Fulfillment is kept in the demo catalogue to exercise this path.",
  },
];

export default async function SecurityPage() {
  const { user } = await requireUserPage();
  const vault = await vaultForUser(user.id);
  const policy = await policyForUser(user.id);
  const live = vault?.rail === "testnet";

  return (
    <div className="space-y-8">
      <PageHeader
        kicker="Security model"
        title={
          <>
            Bounded by a contract you <span className="font-serif font-normal italic">own</span>.
          </>
        }
        description="Not “trustless”. The honest claim is narrower: money movement and spending limits are enforced by an immutable vault contract, while catalogue validation, approvals and rate limits have backend components. This page says which is which."
        actions={<RailBadge rail={vault?.rail ?? "mock"} />}
      />

      <section className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-paper p-5">
          <div className="label">Current rail</div>
          <div className="mt-2 text-sm font-semibold">
            {live ? "NEAR testnet vault" : "Mock rail"}
          </div>
          <p className="mt-1 text-[10px] leading-4 text-muted">
            {live
              ? "Limits are enforced by the contract."
              : "Limits are enforced by this backend only."}
          </p>
        </div>
        <div className="bg-paper p-5">
          <div className="label">Vault account</div>
          <div className="mt-2 font-mono text-xs">{shortAccount(vault?.account_id)}</div>
          <p className="mt-1 text-[10px] leading-4 text-muted">
            {vault ? `${vault.network} · ${vault.chain_status}` : "No vault provisioned"}
          </p>
        </div>
        <div className="bg-paper p-5">
          <div className="label">Policy</div>
          <div className="mt-2 text-sm font-semibold">
            {policy ? `v${policy.row.version} · ${policy.row.status}` : "none"}
          </div>
          <p className="mt-1 text-[10px] leading-4 text-muted">
            One policy governs every agent on this vault.
          </p>
        </div>
        <div className="bg-paper p-5">
          <div className="label">Asset</div>
          <div className="mt-2">
            <TokenChip />
          </div>
          <p className="mt-1 text-[10px] leading-4 text-muted">
            A demo NEP-141 token. Not Circle USDC.
          </p>
        </div>
      </section>

      {!live ? (
        <Callout tone="blue" title="This workspace is on the mock rail">
          A wallet login never hands over a signing key, so this session cannot produce a real
          vault transaction. Every limit below is still checked by the backend, but there is no
          cryptographic enforcement and no chain settlement. The UI labels every payment
          accordingly.
        </Callout>
      ) : null}

      <section className="space-y-3">
        <div>
          <div className="label">Enforcement matrix</div>
          <h2 className="mt-1 text-2xl font-semibold tracking-[-0.035em]">
            What stops what, and where
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            “If the backend is fully compromised” is the column that matters. A control is only
            an on-chain guarantee if it survives that scenario.
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-line bg-paper/50">
          <div className="hidden grid-cols-[1.05fr_1.1fr_1fr_1.2fr] gap-3 border-b border-line bg-paper-deep/70 px-4 py-2.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted lg:grid">
            <span>Control</span>
            <span>On-chain</span>
            <span>Backend</span>
            <span>If the backend is compromised</span>
          </div>
          {MATRIX.map((row) => (
            <div
              key={row.control}
              className="grid gap-2 border-b border-line px-4 py-3 last:border-b-0 lg:grid-cols-[1.05fr_1.1fr_1fr_1.2fr] lg:items-start lg:gap-3"
            >
              <div className="text-xs font-semibold">{row.control}</div>
              <div className="flex items-start gap-1.5 text-[11px] leading-4 text-ink-soft">
                {row.chain === "No" || row.chain === "N/A" ? (
                  <CircleAlert className="mt-0.5 h-3 w-3 shrink-0 text-amber" aria-hidden />
                ) : (
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-green" aria-hidden />
                )}
                {row.chain}
              </div>
              <div className="text-[11px] leading-4 text-muted">{row.backend}</div>
              <div className="text-[11px] leading-4 text-muted">{row.compromise}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="card-solid overflow-hidden">
          <div className="border-b border-line bg-paper-deep/50 px-5 py-4">
            <div className="flex items-center gap-2">
              <Fingerprint className="h-4 w-4 text-muted" aria-hidden />
              <div>
                <div className="label">Threat model</div>
                <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
                  The attacks we designed for
                </h2>
              </div>
            </div>
          </div>
          <div className="divide-y divide-line">
            {THREATS.map((threat) => (
              <div key={threat.id} className="px-5 py-4">
                <div className="flex items-center gap-2">
                  <span className="badge border-line-strong bg-paper-deep text-muted">
                    {threat.id}
                  </span>
                  <span className="text-sm font-semibold">{threat.title}</span>
                </div>
                <p className="mt-1.5 text-[11px] leading-5 text-muted">{threat.body}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="space-y-5">
          <section className="card-solid overflow-hidden">
            <div className="border-b border-line bg-paper-deep/50 px-5 py-4">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-muted" aria-hidden />
                <div>
                  <div className="label">Fee atomicity</div>
                  <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
                    Why failure cannot be charged
                  </h2>
                </div>
              </div>
            </div>
            <div className="px-5 py-4 text-xs leading-6 text-muted">
              <p>
                The merchant transfer and the fee transfer are not parallel promises. The fee
                callback is chained after the merchant transfer succeeds. If the merchant transfer
                fails, the fee promise is never created.
              </p>
              <p className="mt-2">
                This makes “no fee on failure” a structural property, not a conditional in the
                backend. The fee ledger records only successful settlements.
              </p>
              <div className="mt-3 rounded-lg border border-line bg-paper-deep/40 p-3 font-mono text-[10px] leading-5">
                merchant ft_transfer → callback → fee ft_transfer → callback
              </div>
            </div>
          </section>

          <section className="card-solid overflow-hidden">
            <div className="border-b border-line bg-paper-deep/50 px-5 py-4">
              <div className="flex items-center gap-2">
                <Landmark className="h-4 w-4 text-muted" aria-hidden />
                <div>
                  <div className="label">Custody</div>
                  <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
                    Who holds the keys
                  </h2>
                </div>
              </div>
            </div>
            <div className="px-5 py-4 text-xs leading-6 text-muted">
              <p>
                A real vault is owned by the user&apos;s NEAR account. The owner key can pause,
                change the policy, add or remove merchants, and withdraw. Agents get a
                function-call key scoped to <code className="font-mono">pay</code>.
              </p>
              <p className="mt-2">
                This demo workspace is the exception the UI keeps repeating: the server holds the
                seeded testnet workspace&apos;s keys so the browser demo can run without a wallet
                extension. That is not the production custody model.
              </p>
            </div>
          </section>
        </div>
      </div>

      <section className="card-solid overflow-hidden">
        <div className="border-b border-line bg-paper-deep/50 px-5 py-4">
          <div className="flex items-center gap-2">
            <ServerCog className="h-4 w-4 text-muted" aria-hidden />
            <div>
              <div className="label">Honest limitations</div>
              <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">
                What this build does not claim
              </h2>
            </div>
          </div>
        </div>
        <div className="grid gap-x-8 gap-y-4 px-5 py-5 md:grid-cols-2">
          {[
            {
              title: "TESTUSD is not USDC",
              body: "Circle's testnet faucet could not be automated, so the live demo uses a clearly labelled NEP-141 test token with 6 decimals. The rail adapter is asset-agnostic; production would point at Circle USDC.",
            },
            {
              title: "The demo signer is a demo",
              body: "Wallet sessions use the mock rail because a NEP-413 login proves ownership but does not hand over a signing key. A production build would have the user wallet sign owner actions and agent-key creation.",
            },
            {
              title: "SQLite, not Postgres",
              body: "The PRD names Postgres + Drizzle. This environment has no Docker or Postgres, so the backend uses Node's built-in SQLite with BEGIN IMMEDIATE serialization. Single-instance only; a production deployment would migrate.",
            },
            {
              title: "Merchant login is a demo shortcut",
              body: "Merchants are selected from a seeded list; there is no production merchant onboarding or KYB. The merchant API credential and webhook signing are real within that scope.",
            },
            {
              title: "No independent audit",
              body: "The contract is small and non-upgradeable, but it has not been audited. Only testnet balances belong anywhere near it.",
            },
            {
              title: "Webhooks are allowlisted",
              body: "Outbound delivery is disabled unless the destination host appears in AGENTSPEND_WEBHOOK_HOSTS. The test endpoint returns a signed sample without an outbound call, which is what the demo exercises.",
            },
            {
              title: "Rate limits are per process",
              body: "The limiter is an in-memory sliding window. A multi-instance deployment needs a shared store (for example Redis) before the limits mean anything.",
            },
            {
              title: "Not trustless",
              body: "The correct claim is “bounded by an immutable contract you own”. The backend still sees metadata, can suppress notifications, and can cause payments the policy already permits.",
            },
          ].map((item) => (
            <div key={item.title}>
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <CircleAlert className="h-3.5 w-3.5 text-amber" aria-hidden />
                {item.title}
              </div>
              <p className="mt-1 text-[11px] leading-5 text-muted">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-4 border-t border-line pt-5 text-[10px] text-muted">
        <span className="flex items-center gap-1.5">
          <FileCode2 className="h-3.5 w-3.5" aria-hidden />
          Rust contract · immutable per vault
        </span>
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-green" aria-hidden />
          FINAL receipt verification
        </span>
        <span className="flex items-center gap-1.5">
          <Lock className="h-3.5 w-3.5" aria-hidden />
          Payout pinned in state
        </span>
        {vault ? (
          <a
            href={explorerAccount(vault.account_id)}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 underline underline-offset-2 hover:text-ink"
          >
            View vault on NEAR Blocks
            <ArrowUpRight className="h-3 w-3" aria-hidden />
          </a>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted">
        <span>
          Token contract: <code className="font-mono">{shortAccount(vault?.token_account)}</code>
        </span>
        <span>
          Network: <code className="font-mono">{appConfig.network}</code>
        </span>
        <Link href="/integrations" className="underline underline-offset-2 hover:text-ink">
          Test the enforcement yourself →
        </Link>
      </div>
    </div>
  );
}
