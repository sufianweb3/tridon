"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  Blocks,
  Fingerprint,
  LayoutDashboard,
  ScrollText,
  ShieldCheck,
  Store,
  UserRoundCog,
  WalletCards,
} from "lucide-react";

const ITEMS = [
  { href: "/dashboard", label: "Control room", icon: LayoutDashboard },
  { href: "/agents", label: "Agents", icon: UserRoundCog },
  { href: "/policy", label: "Policy", icon: ScrollText },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck, badge: true },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/merchants", label: "Merchants", icon: Store },
  { href: "/integrations", label: "Agent API", icon: Blocks },
  { href: "/security", label: "Security model", icon: Fingerprint },
] as const;

function active(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav({
  approvalCount,
  variant = "sidebar",
}: {
  approvalCount: number;
  variant?: "sidebar" | "mobile";
}) {
  const pathname = usePathname();

  if (variant === "mobile") {
    return (
      <nav aria-label="Primary" className="-mx-4 overflow-x-auto px-4 pb-1">
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
                {"badge" in item && approvalCount > 0 ? (
                  <span className="rounded-full bg-lime px-1.5 py-0.5 font-mono text-[9px] text-ink">
                    {approvalCount}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </nav>
    );
  }

  return (
    <nav aria-label="Primary" className="flex flex-col gap-1">
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
            {"badge" in item && approvalCount > 0 ? (
              <span
                className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] ${
                  isActive ? "bg-lime text-ink" : "bg-amber-soft text-amber"
                }`}
              >
                {approvalCount}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function ShellStamp({ rail }: { rail: string }) {
  const live = rail === "testnet";
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-paper/70 px-2.5 py-2">
      <WalletCards className="h-3.5 w-3.5 text-muted" aria-hidden />
      <div className="min-w-0">
        <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">
          {live ? "Live vault rail" : "Mock rail"}
        </div>
        <div className="truncate text-[11px] font-medium text-ink-soft">
          {live ? "NEAR testnet · TESTUSD" : "Backend-enforced · TESTUSD"}
        </div>
      </div>
      <span
        className={`ml-auto h-2 w-2 shrink-0 rounded-full ${live ? "bg-lime-deep animate-pulse-dot" : "bg-blue"}`}
        aria-hidden
      />
    </div>
  );
}
