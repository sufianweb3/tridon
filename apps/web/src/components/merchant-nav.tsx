"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Plug, Store } from "lucide-react";

const ITEMS = [
  { href: "/merchant/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/merchant/integrations", label: "Services & API", icon: Plug },
] as const;

function active(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MerchantNav({ variant = "sidebar" }: { variant?: "sidebar" | "mobile" }) {
  const pathname = usePathname();

  if (variant === "mobile") {
    return (
      <nav aria-label="Merchant" className="-mx-4 overflow-x-auto px-4 pb-1">
        <div className="flex min-w-max items-center gap-1">
          {ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = active(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  isActive
                    ? "border-ink bg-ink text-paper"
                    : "border-line-strong bg-paper/70 text-ink-soft"
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    );
  }

  return (
    <nav aria-label="Merchant" className="flex flex-col gap-1">
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = active(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
              isActive
                ? "bg-ink text-paper"
                : "text-ink-soft hover:bg-paper-deep hover:text-ink"
            }`}
          >
            <Icon
              className={`h-4 w-4 shrink-0 ${isActive ? "text-lime" : "text-muted group-hover:text-ink"}`}
              aria-hidden
            />
            <span className="flex-1">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function MerchantStamp({
  name,
  payoutAccount,
}: {
  name: string;
  payoutAccount: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-paper/70 px-2.5 py-2">
      <Store className="h-3.5 w-3.5 text-muted" aria-hidden />
      <div className="min-w-0">
        <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">
          Merchant payout
        </div>
        <div className="truncate font-mono text-[10px] font-medium text-ink-soft">
          {payoutAccount}
        </div>
      </div>
      <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-blue" aria-hidden />
    </div>
  );
}
