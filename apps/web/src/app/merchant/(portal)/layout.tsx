import type { ReactNode } from "react";
import Link from "next/link";
import { requireMerchantPage } from "@/lib/server-auth";
import { shortAccount } from "@/lib/format";
import { LogoutButton } from "@/components/actions";
import { MerchantNav, MerchantStamp } from "@/components/merchant-nav";
import { TokenChip, Wordmark } from "@/components/ui";

export default async function MerchantPortalLayout({ children }: { children: ReactNode }) {
  const { merchant } = await requireMerchantPage();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[252px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-paper-deep/60 px-4 py-5 lg:flex">
        <Wordmark href="/merchant/dashboard" />
        <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.18em] text-muted">
          Merchant portal
        </div>
        <div className="mt-7 flex-1 overflow-y-auto">
          <MerchantNav />
          <div className="mt-6 space-y-2">
            <MerchantStamp name={merchant.merchantName} payoutAccount={merchant.payoutAccount} />
            <p className="rounded-lg border border-blue/20 bg-blue-soft/50 px-2.5 py-2 text-[10px] leading-4 text-blue">
              Demo merchant session. Production merchant auth, onboarding and KYB are out of
              scope.
            </p>
          </div>
        </div>
        <div className="mt-4 border-t border-line pt-4">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-full border border-line-strong bg-paper text-[11px] font-semibold">
              {merchant.merchantName.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{merchant.merchantName}</div>
              <div className="truncate font-mono text-[9px] text-muted">
                {shortAccount(merchant.payoutAccount)}
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <TokenChip />
            <LogoutButton kind="merchant" />
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="border-b border-line bg-paper/90 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <Wordmark href="/merchant/dashboard" />
            <div className="flex items-center gap-2">
              <TokenChip />
              <LogoutButton kind="merchant" />
            </div>
          </div>
          <div className="mt-3">
            <MerchantNav variant="mobile" />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1200px] px-4 py-7 md:px-8 md:py-9">
          {children}
        </main>

        <footer className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-2 px-4 pb-8 text-[10px] text-muted md:px-8">
          <span>
            Merchant payouts are testnet TESTUSD. A payment is only shown as settled after the
            rail verifies the transfer.
          </span>
          <Link href="/" className="underline underline-offset-2 hover:text-ink">
            About AgentSpend
          </Link>
        </footer>
      </div>
    </div>
  );
}
