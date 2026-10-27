import Link from "next/link";
import type { ReactNode } from "react";
import { formatUsd } from "@agentspend/core";
import { percentOf } from "@/lib/format";

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-2.5">
      <span className="relative grid h-8 w-8 place-items-center rounded-lg border border-ink bg-ink text-paper">
        <span className="font-mono text-[13px] font-semibold tracking-tight">A$</span>
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-paper bg-lime" />
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-[-0.02em]">AgentSpend</span>
        <span className="mt-1 font-mono text-[8px] uppercase tracking-[0.22em] text-muted">
          NEAR testnet
        </span>
      </span>
    </Link>
  );
}

const STATUS_STYLES: Record<string, string> = {
  succeeded: "border-green/30 bg-green-soft text-green",
  active: "border-green/30 bg-green-soft text-green",
  ready: "border-green/30 bg-green-soft text-green",
  delivered: "border-green/30 bg-green-soft text-green",
  approved: "border-green/30 bg-green-soft text-green",
  allowed: "border-green/30 bg-green-soft text-green",
  awaiting_approval: "border-amber/30 bg-amber-soft text-amber",
  pending: "border-amber/30 bg-amber-soft text-amber",
  authorized: "border-amber/30 bg-amber-soft text-amber",
  held: "border-amber/30 bg-amber-soft text-amber",
  paused: "border-amber/30 bg-amber-soft text-amber",
  submitted: "border-blue/30 bg-blue-soft text-blue",
  confirming: "border-blue/30 bg-blue-soft text-blue",
  unknown: "border-blue/30 bg-blue-soft text-blue",
  denied: "border-rust/30 bg-rust-soft text-rust",
  failed: "border-rust/30 bg-rust-soft text-rust",
  expired: "border-rust/30 bg-rust-soft text-rust",
  revoked: "border-rust/30 bg-rust-soft text-rust",
  open: "border-line-strong bg-paper-deep text-ink-soft",
  created: "border-line-strong bg-paper-deep text-ink-soft",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const style = STATUS_STYLES[status] ?? "border-line-strong bg-paper-deep text-muted";
  return (
    <span className={cn("badge", style, className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function RailBadge({ rail }: { rail: string }) {
  const live = rail === "testnet";
  return (
    <span
      className={cn(
        "badge",
        live
          ? "border-lime-deep/60 bg-lime/25 text-moss"
          : "border-blue/30 bg-blue-soft text-blue",
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {live ? "NEAR testnet · on-chain vault" : "Mock rail · backend only"}
    </span>
  );
}

export function Money({
  units,
  className,
  symbol = true,
}: {
  units: string | bigint;
  className?: string;
  symbol?: boolean;
}) {
  const value = typeof units === "bigint" ? units : BigInt(units);
  const formatted = formatUsd(value);
  return <span className={className}>{symbol ? formatted : formatted.replace("$", "")}</span>;
}

export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="label">{label}</div>
      <div className="mt-2 truncate text-xl font-semibold tracking-[-0.03em] tabular-nums">
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

export function PageHeader({
  kicker,
  title,
  description,
  actions,
}: {
  kicker?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-5 border-b border-line pb-6 md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl">
        {kicker ? <div className="label mb-3">{kicker}</div> : null}
        <h1 className="text-balance text-3xl font-semibold tracking-[-0.04em] md:text-[2.6rem] md:leading-[1.05]">
          {title}
        </h1>
        {description ? (
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Progress({
  part,
  total,
  tone = "ink",
  className,
}: {
  part: bigint;
  total: bigint;
  tone?: "ink" | "lime" | "rust" | "amber";
  className?: string;
}) {
  const percent = percentOf(part, total);
  const tones: Record<string, string> = {
    ink: "bg-ink",
    lime: "bg-lime-deep",
    rust: "bg-rust",
    amber: "bg-amber",
  };
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-line/70", className)}
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", tones[tone])}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-line-strong bg-paper/60 p-6">
      <p className="text-sm font-semibold">{title}</p>
      <p className="max-w-md text-sm leading-6 text-muted">{body}</p>
      {action}
    </div>
  );
}

export function Callout({
  tone = "paper",
  title,
  children,
  action,
}: {
  tone?: "paper" | "lime" | "rust" | "amber" | "blue";
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const tones: Record<string, string> = {
    paper: "border-line bg-paper-deep/70",
    lime: "border-lime-deep/50 bg-lime/20",
    rust: "border-rust/25 bg-rust-soft/60",
    amber: "border-amber/25 bg-amber-soft/60",
    blue: "border-blue/20 bg-blue-soft/60",
  };
  return (
    <div className={cn("rounded-xl border p-4", tones[tone])}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm font-semibold">{title}</p>
        {action}
      </div>
      <div className="mt-1.5 text-sm leading-6 text-ink-soft">{children}</div>
    </div>
  );
}

export function KeyValue({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-line/70 py-3 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
      <span className="label shrink-0">{label}</span>
      <span
        className={cn(
          "min-w-0 break-all text-right text-sm text-ink-soft",
          mono && "font-mono text-xs",
        )}
      >
        {children}
      </span>
    </div>
  );
}

export function TokenChip({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-paper px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft">
      <span className="h-1.5 w-1.5 rounded-full bg-amber" aria-hidden />
      {label ?? "TESTUSD · demo token"}
    </span>
  );
}

export function SectionHeading({
  kicker,
  title,
  body,
  className,
}: {
  kicker?: string;
  title: string;
  body?: string;
  className?: string;
}) {
  return (
    <div className={cn("max-w-2xl", className)}>
      {kicker ? <div className="label mb-3">{kicker}</div> : null}
      <h2 className="text-balance text-2xl font-semibold tracking-[-0.035em] md:text-3xl">
        {title}
      </h2>
      {body ? <p className="mt-3 text-sm leading-6 text-muted">{body}</p> : null}
    </div>
  );
}
