import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleDollarSign,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  Minus,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";
import { Wordmark, TokenChip } from "@/components/ui";

const TICKER = [
  "Deterministic policy engine",
  "Integer base units",
  "Atomic budget reservations",
  "Idempotent payment requests",
  "FINAL receipt verification",
  "No fee on blocked or failed payments",
  "Agent keys scoped to pay()",
];

const POLICY_ROWS = [
  {
    merchant: "Northstar Compute",
    detail: "allowlisted · $3.50",
    state: "settled",
    tone: "lime",
  },
  {
    merchant: "DataForge",
    detail: "allowlisted · $12.00",
    state: "settled",
    tone: "lime",
  },
  {
    merchant: "Lighthouse Research",
    detail: "approval required · $24.00",
    state: "pending",
    tone: "amber",
  },
  {
    merchant: "Atlas Data Co.",
    detail: "not allowlisted · $4.50",
    state: "denied",
    tone: "rust",
  },
];

const STEPS = [
  {
    number: "01",
    title: "Provision a vault",
    body: "A dedicated testnet account holds the funds. The user account is the owner; the platform never keeps the owner key.",
  },
  {
    number: "02",
    title: "Write the policy",
    body: "Caps, merchant allowlist, payout accounts and approval rules are written to contract state and versioned.",
  },
  {
    number: "03",
    title: "Issue a scoped key",
    body: "Each agent gets its own function-call key. It can call pay() on this vault and nothing else.",
  },
  {
    number: "04",
    title: "Settle with proof",
    body: "The rail verifies the exact NEP-141 transfer at FINAL. Fees are chained after merchant success, so failures cannot be charged.",
  },
];

const MATRIX = [
  {
    control: "Per-payment cap",
    backend: "Pre-check + reserve",
    chain: "Rejects in pay()",
    note: "Both layers use the same integer amount.",
  },
  {
    control: "Daily / weekly / monthly caps",
    backend: "Reservation windows",
    chain: "Rolling windows in state",
    note: "Held and committed amounts both count.",
  },
  {
    control: "Merchant allowlist",
    backend: "Policy lookup",
    chain: "Pinned merchant rules",
    note: "Unknown means not on this user's allowlist.",
  },
  {
    control: "Payout destination",
    backend: "Never accepts an agent-supplied account",
    chain: "ft_transfer to stored payout",
    note: "The agent cannot redirect a payment.",
  },
  {
    control: "Duplicate request",
    backend: "Idempotency key + unique index",
    chain: "Seen payment-id hash",
    note: "Retries return the original result.",
  },
  {
    control: "Pause / revoke",
    backend: "Denies new requests",
    chain: "pause() and key deletion",
    note: "Chain action happens first on revoke.",
  },
];

const SCENARIOS = [
  { label: "Allowed compute payment", amount: "$3.50", state: "succeeded", tone: "green" },
  { label: "Allowed dataset payment", amount: "$12.00", state: "succeeded", tone: "green" },
  { label: "Approval above threshold", amount: "$24.00", state: "awaiting approval", tone: "amber" },
  { label: "Over per-payment cap", amount: "$50.00", state: "denied", tone: "rust" },
  { label: "Merchant not allowlisted", amount: "$4.50", state: "denied", tone: "rust" },
  { label: "Merchant settlement fails", amount: "$1.00", state: "failed · no fee", tone: "rust" },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 md:px-6">
          <Wordmark />
          <nav className="hidden items-center gap-7 text-xs text-muted md:flex">
            <a href="#gap" className="hover:text-ink">
              The gap
            </a>
            <a href="#how" className="hover:text-ink">
              How it works
            </a>
            <a href="#enforcement" className="hover:text-ink">
              Enforcement
            </a>
            <a href="#limits" className="hover:text-ink">
              Limits
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href="/merchant/login"
              className="hidden text-xs text-muted hover:text-ink sm:block"
            >
              For merchants
            </Link>
            <Link href="/login" className="btn btn-primary !px-3.5 !py-2 !text-xs">
              Enter demo
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="grid-paper border-b border-line">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 md:px-6 md:py-16 lg:grid-cols-[1.08fr_0.92fr] lg:gap-14 lg:py-20">
            <div className="flex flex-col justify-center">
              <div className="mb-5 flex flex-wrap items-center gap-2">
                <TokenChip />
                <span className="badge border-line-strong bg-paper/70 text-ink-soft">
                  Track 06 · AI security &amp; defense
                </span>
              </div>
              <h1 className="text-balance text-[2.9rem] font-semibold leading-[0.94] tracking-[-0.055em] sm:text-6xl lg:text-[4.5rem]">
                An agent with a wallet needs a{" "}
                <span className="font-serif font-normal italic tracking-[-0.02em]">leash</span>.
              </h1>
              <p className="mt-6 max-w-xl text-[15px] leading-7 text-ink-soft">
                AgentSpend puts a per-user vault between your AI agent and the merchant. Every
                payment is checked by a deterministic policy, reserved against the budget
                atomically, and settled only when the chain confirms the exact payout.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/login" className="btn btn-lime !px-5 !py-3 !text-sm">
                  Open the live demo
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <a href="#enforcement" className="btn btn-ghost !px-5 !py-3 !text-sm">
                  Read the enforcement matrix
                </a>
              </div>
              <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-green" aria-hidden />
                  NEAR testnet
                </span>
                <span className="flex items-center gap-1.5">
                  <LockKeyhole className="h-3.5 w-3.5 text-green" aria-hidden />
                  No agent withdrawal key
                </span>
                <span className="flex items-center gap-1.5">
                  <ReceiptText className="h-3.5 w-3.5 text-green" aria-hidden />
                  FINAL-only settlement
                </span>
              </div>
            </div>

            <div className="relative">
              <div className="absolute -inset-2 -z-10 rounded-[2rem] bg-lime/25 blur-2xl" aria-hidden />
              <div className="card-solid relative overflow-hidden">
                <div className="flex items-center justify-between border-b border-line bg-paper-deep/60 px-5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-green animate-pulse-dot" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-soft">
                      Policy v7 · active
                    </span>
                  </div>
                  <span className="font-mono text-[9px] text-muted">research-agent</span>
                </div>

                <div className="px-5 pb-5 pt-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="label">Remaining this month</div>
                      <div className="mt-1 font-serif text-6xl leading-none tracking-[-0.03em]">
                        $187.50
                      </div>
                    </div>
                    <div className="rounded-lg border border-line bg-paper px-2.5 py-2 text-right">
                      <div className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted">
                        Vault balance
                      </div>
                      <div className="mt-1 font-mono text-xs">$200.00</div>
                    </div>
                  </div>

                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-line">
                    <div className="h-full w-[62.5%] rounded-full bg-ink" />
                  </div>
                  <div className="mt-2 flex justify-between font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
                    <span>$312.50 committed + held</span>
                    <span>$500.00 budget</span>
                  </div>

                  <div className="mt-5 space-y-1.5">
                    {POLICY_ROWS.map((row) => (
                      <div
                        key={row.merchant}
                        className="flex items-center justify-between rounded-lg border border-line bg-paper/70 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-[11px] font-medium">{row.merchant}</div>
                          <div className="font-mono text-[8px] uppercase tracking-[0.1em] text-muted">
                            {row.detail}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span
                            className={`font-mono text-[9px] uppercase tracking-[0.08em] ${
                              row.tone === "lime"
                                ? "text-green"
                                : row.tone === "amber"
                                  ? "text-amber"
                                  : "text-rust"
                            }`}
                          >
                            {row.state}
                          </span>
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              row.tone === "lime"
                                ? "bg-green"
                                : row.tone === "amber"
                                  ? "bg-amber"
                                  : "bg-rust"
                            }`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-line bg-paper-deep/40 px-5 py-3 font-mono text-[9px] text-muted">
                  <span className="truncate">vault.as-demo-vault.testnet</span>
                  <span className="flex items-center gap-1 text-green">
                    <Check className="h-3 w-3" aria-hidden />
                    on-chain
                  </span>
                </div>
              </div>
              <div className="absolute -bottom-5 -left-4 hidden rounded-xl border border-amber/30 bg-amber-soft px-3 py-2 shadow-card sm:block">
                <div className="font-mono text-[8px] uppercase tracking-[0.12em] text-amber">
                  Human gate
                </div>
                <div className="mt-0.5 text-[11px] font-medium text-ink">
                  $24.00 waiting for approval
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="overflow-hidden border-b border-line bg-ink py-2.5 text-paper">
          <div className="ticker-track flex w-max items-center gap-6">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex items-center gap-6" aria-hidden={copy === 1}>
                {TICKER.map((item) => (
                  <span
                    key={`${copy}-${item}`}
                    className="flex items-center gap-6 whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.16em] text-paper/60"
                  >
                    {item}
                    <span className="h-1 w-1 rounded-full bg-lime/70" />
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        <section id="gap" className="border-b border-line">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 md:px-6 md:py-20">
            <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
              <div>
                <div className="label mb-3">The gap</div>
                <h2 className="text-balance text-3xl font-semibold tracking-[-0.04em] md:text-[2.7rem] md:leading-[1.02]">
                  Agents are getting purchase power before they get{" "}
                  <span className="font-serif font-normal italic">judgment</span>.
                </h2>
              </div>
              <div className="space-y-8">
                <p className="max-w-xl text-[15px] leading-7 text-ink-soft">
                  The usual integration gives an agent a funded key and a system prompt that says
                  &ldquo;spend responsibly.&rdquo; That is not a control. A prompt injection, a
                  retry loop or a compromised tool turns it into an unlimited card.
                </p>
                <div className="grid gap-4 sm:grid-cols-3">
                  {[
                    {
                      icon: KeyRound,
                      title: "Unlimited authority",
                      body: "A full-access key can transfer anything, anywhere. Prompt rules cannot revoke it.",
                    },
                    {
                      icon: CircleDollarSign,
                      title: "Unbounded retries",
                      body: "A looping agent can double-charge a merchant before a human notices.",
                    },
                    {
                      icon: AlertTriangle,
                      title: "Unverifiable success",
                      body: "A submitted transaction is not a paid invoice. Fulfilling on hope is how agents lose money.",
                    },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.title} className="border-t border-ink pt-4">
                        <Icon className="h-5 w-5 text-rust" aria-hidden />
                        <h3 className="mt-3 text-sm font-semibold">{item.title}</h3>
                        <p className="mt-1.5 text-xs leading-5 text-muted">{item.body}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="how" className="border-b border-line bg-paper-deep/40">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 md:px-6 md:py-20">
            <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
              <div>
                <div className="label mb-3">The mechanism</div>
                <h2 className="text-balance text-3xl font-semibold tracking-[-0.04em] md:text-[2.7rem]">
                  A vault, a policy, a scoped key.
                </h2>
              </div>
              <p className="max-w-sm text-sm leading-6 text-muted">
                The authorization decision is deterministic code, not a model. The model can ask;
                the contract decides.
              </p>
            </div>

            <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-4">
              {STEPS.map((step) => (
                <div key={step.number} className="bg-paper p-5 md:p-6">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] tracking-[0.14em] text-muted">
                      {step.number}
                    </span>
                    <ArrowUpRight className="h-4 w-4 text-line-strong" aria-hidden />
                  </div>
                  <h3 className="mt-6 text-base font-semibold tracking-[-0.02em]">{step.title}</h3>
                  <p className="mt-2 text-xs leading-5 text-muted">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="enforcement" className="border-b border-line">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 md:px-6 md:py-20">
            <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr]">
              <div>
                <div className="label mb-3">Enforcement matrix</div>
                <h2 className="text-balance text-3xl font-semibold tracking-[-0.04em] md:text-[2.7rem] md:leading-[1.02]">
                  Two layers. One of them belongs to the chain.
                </h2>
                <p className="mt-4 max-w-md text-sm leading-6 text-muted">
                  The backend makes fast decisions and reserves budget. The vault contract is the
                  authority that survives a compromised server, a leaked agent token or a bug in
                  the API.
                </p>
                <div className="mt-6 space-y-2">
                  <div className="flex items-start gap-2 text-xs text-ink-soft">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green" aria-hidden />
                    On-chain: caps, allowlist, payout account, duplicate payment IDs, pause.
                  </div>
                  <div className="flex items-start gap-2 text-xs text-ink-soft">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green" aria-hidden />
                    Backend: request validation, reservations, approvals, audit and settlement
                    verification.
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-line">
                <div className="grid grid-cols-[1.1fr_0.8fr_0.8fr] gap-3 border-b border-line bg-paper-deep/70 px-4 py-3 font-mono text-[9px] uppercase tracking-[0.12em] text-muted">
                  <span>Control</span>
                  <span>Backend</span>
                  <span>Vault contract</span>
                </div>
                {MATRIX.map((row) => (
                  <div
                    key={row.control}
                    className="grid grid-cols-[1.1fr_0.8fr_0.8fr] gap-3 border-b border-line px-4 py-3 last:border-b-0"
                  >
                    <div>
                      <div className="text-xs font-medium">{row.control}</div>
                      <div className="mt-0.5 text-[10px] leading-4 text-muted">{row.note}</div>
                    </div>
                    <div className="flex items-start gap-1.5 text-[11px] leading-4 text-ink-soft">
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-green" aria-hidden />
                      {row.backend}
                    </div>
                    <div className="flex items-start gap-1.5 text-[11px] leading-4 text-ink-soft">
                      <LockKeyhole className="mt-0.5 h-3 w-3 shrink-0 text-green" aria-hidden />
                      {row.chain}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-line bg-ink text-paper">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-14 md:px-6 md:py-20 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-paper/40">
                Seeded proof
              </div>
              <h2 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.04em] md:text-[2.7rem] md:leading-[1.02]">
                A demo you can audit, not just watch.
              </h2>
              <p className="mt-4 max-w-md text-sm leading-6 text-paper/60">
                The seed runs six real testnet scenarios. Every allowed payment is verified at
                FINAL; the failed merchant is deliberately unable to receive the token, so the
                fee path is never reached.
              </p>
              <Link href="/login" className="btn btn-lime mt-7 !px-5 !py-3 !text-sm">
                Open the control room
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>

            <div className="rounded-2xl border border-paper/15 bg-paper/[0.04]">
              <div className="flex items-center justify-between border-b border-paper/10 px-4 py-3">
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-paper/50">
                  Demo payment ledger
                </span>
                <span className="font-mono text-[9px] text-lime">TESTUSD · 6 decimals</span>
              </div>
              {SCENARIOS.map((scenario) => (
                <div
                  key={scenario.label}
                  className="flex items-center justify-between gap-3 border-b border-paper/10 px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs text-paper/85">{scenario.label}</div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-paper/35">
                      {scenario.state}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-xs text-paper/70">{scenario.amount}</span>
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        scenario.tone === "green"
                          ? "bg-lime"
                          : scenario.tone === "amber"
                            ? "bg-amber"
                            : "bg-rust"
                      }`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="limits" className="border-b border-line">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 md:px-6 md:py-20">
            <div className="label mb-3">Hard boundaries</div>
            <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
              <h2 className="max-w-xl text-balance text-3xl font-semibold tracking-[-0.04em] md:text-[2.7rem]">
                What this build does not pretend to be.
              </h2>
              <p className="max-w-sm text-sm leading-6 text-muted">
                The demo is deliberately honest about its trust model. Read this before judging
                the screenshots.
              </p>
            </div>
            <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  icon: Fingerprint,
                  title: "Testnet only",
                  body: "Every vault, token and payout account lives on NEAR testnet. No mainnet funds are touched.",
                },
                {
                  icon: CircleDollarSign,
                  title: "TESTUSD, not USDC",
                  body: "The rail uses a labelled demo NEP-141 token with 6 decimals. It is not Circle USDC.",
                },
                {
                  icon: KeyRound,
                  title: "Demo signer",
                  body: "The seeded workspace is controlled by a server-side testnet signer. A real user would hold the owner key in their wallet.",
                },
                {
                  icon: ShieldCheck,
                  title: "Wallet sessions use the mock rail",
                  body: "A NEP-413 wallet login never hands over a signing key, so those sessions enforce limits in the backend and say so.",
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="rounded-xl border border-line bg-paper/60 p-4">
                    <Icon className="h-4 w-4 text-rust" aria-hidden />
                    <h3 className="mt-3 text-sm font-semibold">{item.title}</h3>
                    <p className="mt-1.5 text-xs leading-5 text-muted">{item.body}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="bg-lime">
          <div className="mx-auto flex w-full max-w-6xl flex-col justify-between gap-6 px-4 py-12 md:flex-row md:items-center md:px-6">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-moss/60">
                NEAR hackathon · AI security &amp; defense
              </div>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-ink md:text-4xl">
                Give the agent a budget, not the keys.
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/login" className="btn btn-primary !px-5 !py-3 !text-sm">
                Enter the demo
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link href="/merchant/login" className="btn btn-ghost !border-ink/40 !px-5 !py-3 !text-sm">
                Merchant view
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-paper">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-8 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="flex items-center gap-3">
            <Wordmark />
          </div>
          <p className="max-w-md text-[10px] leading-4 text-muted">
            AgentSpend is a hackathon build. TESTUSD is a demo token with no monetary value.
            Settlement verification, policy enforcement and fee accounting are real testnet
            operations; the demo signer and merchant login are not production patterns.
          </p>
          <div className="flex items-center gap-4 text-[10px] text-muted">
            <Link href="/login" className="hover:text-ink">
              Demo
            </Link>
            <Link href="/merchant/login" className="hover:text-ink">
              Merchants
            </Link>
            <span className="flex items-center gap-1">
              <Minus className="h-3 w-3" aria-hidden />
              Testnet
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
