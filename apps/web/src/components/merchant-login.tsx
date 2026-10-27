"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  FlaskConical,
  Loader2,
  Lock,
  Store,
  Webhook,
} from "lucide-react";
import { api, errorMessage } from "@/lib/client";
import { shortAccount } from "@/lib/format";
import { TokenChip, Wordmark } from "@/components/ui";

export interface MerchantChoice {
  id: string;
  name: string;
  category: string;
  description: string;
  payoutAccount: string;
}

export function MerchantLogin({
  merchants,
  demoEnabled,
}: {
  merchants: MerchantChoice[];
  demoEnabled: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(merchants[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/merchant/login", {
        method: "POST",
        body: { merchantId: selected },
      });
      router.push("/merchant/dashboard");
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1.05fr_0.95fr]">
      <div className="flex min-h-screen flex-col px-5 py-6 md:px-10 md:py-8">
        <div className="flex items-center justify-between">
          <Wordmark />
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Spender sign in
          </Link>
        </div>

        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center py-12">
          <div className="label mb-3">Merchant portal</div>
          <h1 className="text-balance text-4xl font-semibold tracking-[-0.045em] md:text-[3.2rem] md:leading-[0.98]">
            See what actually <span className="font-serif italic font-normal">settled</span>.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-muted">
            Merchants get their own credential, service catalogue and webhook signing secret.
            Payment success here means the rail verified the transfer — not that an agent said it
            paid.
          </p>

          <div className="mt-8 space-y-2">
            <div className="label">Choose a demo merchant</div>
            {merchants.map((merchant) => {
              const active = selected === merchant.id;
              return (
                <button
                  key={merchant.id}
                  type="button"
                  onClick={() => setSelected(merchant.id)}
                  aria-pressed={active}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors ${
                    active
                      ? "border-ink bg-lime/15"
                      : "border-line bg-paper/60 hover:border-line-strong"
                  }`}
                >
                  <span
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${
                      active ? "border-ink bg-ink text-paper" : "border-line-strong bg-paper"
                    }`}
                  >
                    <Store className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-semibold">{merchant.name}</span>
                      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
                        {merchant.category}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-muted">
                      payout {shortAccount(merchant.payoutAccount)}
                    </span>
                  </span>
                  <span
                    className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
                      active ? "border-ink bg-ink" : "border-line-strong"
                    }`}
                  >
                    {active ? <span className="h-1.5 w-1.5 rounded-full bg-lime" /> : null}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={signIn}
            disabled={!demoEnabled || !selected || busy}
            className="btn btn-primary mt-5 w-full !justify-between !rounded-xl !px-4 !py-3.5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="flex items-center gap-2.5">
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <FlaskConical className="h-4 w-4 text-lime" aria-hidden />
              )}
              Open {merchants.find((merchant) => merchant.id === selected)?.name ?? "merchant"}{" "}
              dashboard
            </span>
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>

          {!demoEnabled ? (
            <div className="mt-4 rounded-xl border border-amber/25 bg-amber-soft/60 p-3 text-xs leading-5 text-amber">
              Demo merchant sign-in is disabled in this environment.
            </div>
          ) : null}

          {error ? (
            <p className="mt-4 flex items-start gap-2 rounded-lg border border-rust/25 bg-rust-soft/60 p-3 text-xs leading-5 text-rust">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}

          <div className="mt-7 border-t border-line pt-5">
            <div className="flex flex-wrap items-center gap-2">
              <TokenChip />
              <span className="badge border-blue/25 bg-blue-soft text-blue">
                demo shortcut · no production auth
              </span>
            </div>
            <p className="mt-2 max-w-md text-[10px] leading-4 text-muted">
              This sign-in selects a seeded testnet merchant. There is no merchant onboarding, KYB
              or production session model. The merchant API credential and webhook signing are
              real within that scope.
            </p>
          </div>
        </div>
      </div>

      <div className="relative hidden overflow-hidden border-l border-ink bg-ink p-10 text-paper lg:flex lg:flex-col lg:justify-between">
        <div className="scanline pointer-events-none absolute inset-0 opacity-40" aria-hidden />
        <div className="relative">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-paper/50">
              Settlement view
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-lime">
              <span className="h-1.5 w-1.5 rounded-full bg-lime animate-pulse-dot" />
              FINAL receipt verified
            </span>
          </div>

          <div className="mt-10 rounded-2xl border border-paper/15 bg-paper/[0.04] p-5">
            <div className="label !text-paper/45">Settled to this merchant</div>
            <div className="mt-2 font-serif text-6xl leading-none">$15.00</div>
            <div className="mt-4 space-y-2 font-mono text-[10px] text-paper/55">
              <div className="flex items-center justify-between border-b border-paper/10 pb-2">
                <span>Gross</span>
                <span className="text-paper/85">$15.50</span>
              </div>
              <div className="flex items-center justify-between border-b border-paper/10 pb-2">
                <span>Merchant fee · 0.5%</span>
                <span className="text-paper/85">−$0.08</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Net payout</span>
                <span className="text-lime">$15.42</span>
              </div>
            </div>

            <div className="mt-5 space-y-2">
              {[
                ["DataForge", "$12.00", "settled"],
                ["Northstar Compute", "$3.50", "settled"],
                ["Flaky Fulfillment", "$1.00", "failed · no fee"],
              ].map(([merchant, amount, state]) => (
                <div
                  key={merchant}
                  className="flex items-center justify-between rounded-lg border border-paper/10 px-3 py-2"
                >
                  <div>
                    <div className="text-xs text-paper/85">{merchant}</div>
                    <div className="font-mono text-[8px] uppercase tracking-[0.12em] text-paper/35">
                      {state}
                    </div>
                  </div>
                  <span className="font-mono text-xs text-paper/80">{amount}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="relative mt-10 space-y-3">
          <div className="flex items-start gap-3 rounded-xl border border-paper/10 p-4">
            <Webhook className="mt-0.5 h-4 w-4 shrink-0 text-lime" aria-hidden />
            <p className="text-xs leading-5 text-paper/60">
              Webhooks are signed with HMAC-SHA256 over the timestamp and raw body. Delivery is
              allowlisted by host and refuses redirects.
            </p>
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-paper/10 p-4">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-lime" aria-hidden />
            <p className="text-xs leading-5 text-paper/60">
              A merchant cannot choose the payer, the amount or the policy. It can only publish a
              price and wait for a verified settlement.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
