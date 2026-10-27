import type { ReactNode } from "react";
import Link from "next/link";
import { requireUserPage } from "@/lib/server-auth";
import { setting } from "@/lib/db";
import { vaultForUser } from "@/lib/platform";
import { countPendingApprovals } from "@/lib/views";
import { shortAccount } from "@/lib/format";
import { AppNav, ShellStamp } from "@/components/app-nav";
import { Wordmark, TokenChip } from "@/components/ui";
import { LogoutButton } from "@/components/actions";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user } = await requireUserPage();
  const vault = vaultForUser(user.id);
  const pending = countPendingApprovals(user.id);
  const demo = setting("demo.user_id", "") === user.id;
  const rail = vault?.rail ?? "mock";

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[252px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-paper-deep/60 px-4 py-5 lg:flex">
        <Wordmark href="/dashboard" />
        <div className="mt-8 flex-1 overflow-y-auto">
          <AppNav approvalCount={pending} />
          <div className="mt-6 space-y-2">
            <ShellStamp rail={rail} />
            {demo ? (
              <p className="rounded-lg border border-amber/25 bg-amber-soft/60 px-2.5 py-2 text-[10px] leading-4 text-amber">
                Demo workspace. The server holds this testnet workspace&apos;s keys. Never use
                this pattern with real funds.
              </p>
            ) : (
              <p className="rounded-lg border border-blue/20 bg-blue-soft/50 px-2.5 py-2 text-[10px] leading-4 text-blue">
                Wallet session. The mock rail enforces limits in this backend only; no vault key
                is requested.
              </p>
            )}
          </div>
        </div>
        <div className="mt-4 border-t border-line pt-4">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-full border border-line-strong bg-paper text-[11px] font-semibold">
              {user.displayName.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{user.displayName}</div>
              <div className="truncate font-mono text-[9px] text-muted">
                {shortAccount(user.wallet)}
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <TokenChip />
            <LogoutButton />
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="border-b border-line bg-paper/90 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <Wordmark href="/dashboard" />
            <div className="flex items-center gap-2">
              <TokenChip />
              <LogoutButton />
            </div>
          </div>
          <div className="mt-3">
            <AppNav approvalCount={pending} variant="mobile" />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1200px] px-4 py-7 md:px-8 md:py-9">
          {children}
        </main>

        <footer className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-2 px-4 pb-8 text-[10px] text-muted md:px-8">
          <span>
            TESTUSD is a demo NEP-141 token on NEAR testnet. It is not Circle USDC and has no
            monetary value.
          </span>
          <Link href="/security" className="underline underline-offset-2 hover:text-ink">
            Enforcement model
          </Link>
        </footer>
      </div>
    </div>
  );
}
