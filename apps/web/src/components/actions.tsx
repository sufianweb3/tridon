"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";
import { api, errorMessage } from "@/lib/client";

function Spinner() {
  return <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />;
}

export function CopyButton({
  value,
  label = "Copy",
  className = "btn btn-ghost !px-2.5 !py-1.5 !text-xs",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
      aria-label={copied ? "Copied" : label}
    >
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function LogoutButton({ kind = "user" }: { kind?: "user" | "merchant" }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost !px-3 !py-1.5 !text-xs"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await api(kind === "merchant" ? "/api/merchant/logout" : "/api/auth/logout", {
            method: "POST",
          });
          router.push(kind === "merchant" ? "/merchant/login" : "/login");
          router.refresh();
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? <Spinner /> : null}
      Sign out
    </button>
  );
}

export function SyncBalanceButton({ csrf }: { csrf: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className="btn btn-ghost !px-3 !py-1.5 !text-xs"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          setNote(null);
          try {
            const result = await api<{
              balance: string;
              chainBalance: string | null;
              rail: string;
              note?: string;
            }>("/api/vault/sync", { method: "POST", csrf });
            setNote(
              result.chainBalance
                ? `Chain balance synced (${result.rail}).`
                : (result.note ?? "Local balance only."),
            );
            router.refresh();
          } catch (caught) {
            setError(errorMessage(caught));
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
        Sync balance
      </button>
      {note ? <span className="max-w-[220px] text-right text-[10px] text-green">{note}</span> : null}
      {error ? (
        <span className="max-w-[240px] text-right text-[10px] text-rust">{error}</span>
      ) : null}
    </div>
  );
}

export function ReconcileButton({ paymentId, csrf }: { paymentId: string; csrf: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className="btn btn-ghost !px-3 !py-1.5 !text-xs"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setMessage(null);
          try {
            const result = await api<{ payment: { status: string } }>(
              `/api/transactions/${paymentId}/reconcile`,
              { method: "POST", csrf },
            );
            setMessage(`Chain says: ${result.payment.status.replaceAll("_", " ")}`);
            router.refresh();
          } catch (caught) {
            setMessage(errorMessage(caught));
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? <Spinner /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
        Reconcile with chain
      </button>
      {message ? <span className="text-[10px] text-muted">{message}</span> : null}
    </div>
  );
}

export function ApprovalActions({
  approvalId,
  csrf,
  compact = false,
}: {
  approvalId: string;
  csrf: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "deny") {
    setBusy(decision);
    setError(null);
    try {
      await api(`/api/approvals/${approvalId}/${decision}`, { method: "POST", csrf });
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={compact ? "flex items-center gap-2" : "flex flex-col items-end gap-1"}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-primary !px-3 !py-1.5 !text-xs"
          disabled={busy !== null || pending}
          onClick={() => decide("approve")}
        >
          {busy === "approve" ? <Spinner /> : <Check className="h-3.5 w-3.5" aria-hidden />}
          Approve
        </button>
        <button
          type="button"
          className="btn btn-danger !px-3 !py-1.5 !text-xs"
          disabled={busy !== null || pending}
          onClick={() => decide("deny")}
        >
          {busy === "deny" ? <Spinner /> : <X className="h-3.5 w-3.5" aria-hidden />}
          Deny
        </button>
      </div>
      {error ? <span className="text-[10px] text-rust">{error}</span> : null}
    </div>
  );
}
