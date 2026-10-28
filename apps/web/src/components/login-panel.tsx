"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  FlaskConical,
  Loader2,
  Lock,
  Mail,
  Wallet,
} from "lucide-react";
import { api, base64ToBytes, errorMessage } from "@/lib/client";
import { neonAuthClient } from "@/lib/neon-auth-client";
import { Wordmark, TokenChip } from "@/components/ui";

type Busy = "demo" | "wallet" | "email" | null;

export function LoginPanel({
  demoEnabled,
  demoReady,
  neonEnabled,
}: {
  demoEnabled: boolean;
  demoReady: boolean;
  neonEnabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [emailMode, setEmailMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  async function demoSignIn() {
    setBusy("demo");
    setError(null);
    setNote(null);
    try {
      await api("/api/auth/demo", { method: "POST" });
      router.push("/dashboard");
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function walletSignIn() {
    setBusy("wallet");
    setError(null);
    setNote("Opening the NEAR wallet selector…");
    try {
      const { NearConnector } = await import("@hot-labs/near-connect");
      const connector = new NearConnector({ network: "testnet" });
      const wallet = await connector.connect();
      const accounts = await wallet.getAccounts({ network: "testnet" });
      const account = accounts[0];
      if (!account) throw new Error("The wallet did not return an account.");
      if (!account.accountId.endsWith(".testnet")) {
        throw new Error("This demo accepts NEAR testnet accounts only.");
      }
      setNote("Sign the AgentSpend challenge in your wallet…");
      const challenge = await api<{
        nonce: string;
        message: string;
        recipient: string;
      }>("/api/auth/nonce", {
        method: "POST",
        body: { wallet: account.accountId },
      });
      const signed = await wallet.signMessage({
        message: challenge.message,
        recipient: challenge.recipient,
        nonce: base64ToBytes(challenge.nonce),
        network: "testnet",
        signerId: account.accountId,
      });
      await api("/api/auth/verify", {
        method: "POST",
        body: {
          wallet: account.accountId,
          nonce: challenge.nonce,
          signature: signed.signature,
          publicKey: signed.publicKey ?? account.publicKey,
        },
      });
      router.push("/dashboard");
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
      setNote(null);
    } finally {
      setBusy(null);
    }
  }

  async function emailSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("email");
    setError(null);
    setNote(null);
    try {
      if (password.length < 8) {
        throw new Error("Use at least 8 characters for the password.");
      }
      const result =
        emailMode === "signup"
          ? await neonAuthClient.signUp.email({
              email,
              password,
              name: name.trim() || email.split("@")[0] || "AgentSpend user",
            })
          : await neonAuthClient.signIn.email({ email, password });
      if (result.error) {
        throw new Error(result.error.message ?? "Neon Auth rejected the request.");
      }
      // Neon now holds the credential; this call maps that session onto the
      // application's own HttpOnly session and creates a mock workspace.
      await api("/api/auth/neon-bridge", { method: "POST" });
      router.push("/dashboard");
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1.05fr_0.95fr]">
      <div className="flex min-h-screen flex-col px-5 py-6 md:px-10 md:py-8">
        <div className="flex items-center justify-between">
          <Wordmark />
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Back to overview
          </Link>
        </div>

        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-12">
          <div className="label mb-3">Access</div>
          <h1 className="text-balance text-4xl font-semibold tracking-[-0.045em] md:text-[3.2rem] md:leading-[0.98]">
            Enter the <span className="font-serif italic font-normal">control room</span>.
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-6 text-muted">
            One session shows the vault, the policy the chain enforces, every reservation and
            every merchant payout.
          </p>

          <div className="mt-8 space-y-3">
            <button
              type="button"
              onClick={demoSignIn}
              disabled={!demoEnabled || !demoReady || busy !== null}
              className="btn btn-primary w-full !justify-between !rounded-xl !px-4 !py-3.5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex items-center gap-2.5">
                {busy === "demo" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <FlaskConical className="h-4 w-4 text-lime" aria-hidden />
                )}
                Enter the live demo
              </span>
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>

            <button
              type="button"
              onClick={walletSignIn}
              disabled={busy !== null}
              className="btn btn-ghost w-full !justify-between !rounded-xl !px-4 !py-3.5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex items-center gap-2.5">
                {busy === "wallet" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Wallet className="h-4 w-4" aria-hidden />
                )}
                Connect a NEAR testnet wallet
              </span>
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          </div>

          {neonEnabled ? (
            <form
              onSubmit={emailSignIn}
              className="mt-3 rounded-xl border border-line bg-paper-deep/40 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="label">Email account</span>
                <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
                  <Mail className="h-3 w-3" aria-hidden />
                  Neon Auth
                </span>
              </div>

              <div className="mt-3 space-y-2">
                {emailMode === "signup" ? (
                  <label className="block">
                    <span className="sr-only">Display name</span>
                    <input
                      className="w-full rounded-lg border border-line-strong bg-[#fffdf8] px-3 py-2 text-sm outline-none placeholder:text-muted/70 focus:border-ink focus:shadow-[0_0_0_3px_rgba(216,255,62,0.35)]"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Display name (optional)"
                      autoComplete="name"
                    />
                  </label>
                ) : null}
                <label className="block">
                  <span className="sr-only">Email</span>
                  <input
                    type="email"
                    required
                    className="w-full rounded-lg border border-line-strong bg-[#fffdf8] px-3 py-2 text-sm outline-none placeholder:text-muted/70 focus:border-ink focus:shadow-[0_0_0_3px_rgba(216,255,62,0.35)]"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </label>
                <label className="block">
                  <span className="sr-only">Password</span>
                  <input
                    type="password"
                    required
                    minLength={8}
                    className="w-full rounded-lg border border-line-strong bg-[#fffdf8] px-3 py-2 text-sm outline-none placeholder:text-muted/70 focus:border-ink focus:shadow-[0_0_0_3px_rgba(216,255,62,0.35)]"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Password (8+ characters)"
                    autoComplete={emailMode === "signup" ? "new-password" : "current-password"}
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={busy !== null}
                className="btn btn-ghost mt-3 w-full !justify-between !rounded-lg !px-3 !py-2.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="flex items-center gap-2">
                  {busy === "email" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Mail className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {emailMode === "signup" ? "Create email account" : "Sign in with email"}
                </span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </button>

              <button
                type="button"
                onClick={() => {
                  setEmailMode(emailMode === "signup" ? "signin" : "signup");
                  setError(null);
                }}
                className="mt-2 w-full text-center text-[11px] text-muted underline underline-offset-2 hover:text-ink"
              >
                {emailMode === "signup"
                  ? "I already have an email account"
                  : "Create an email account"}
              </button>

              <p className="mt-3 text-[10px] leading-4 text-muted">
                Email sign-in creates a backend-only mock workspace. It does not create an
                on-chain vault, and TESTUSD is not USDC.
              </p>
            </form>
          ) : null}

          {!demoReady ? (
            <div className="mt-4 rounded-xl border border-amber/25 bg-amber-soft/60 p-3 text-xs leading-5 text-amber">
              The demo workspace is not seeded yet. Run <code className="font-mono">pnpm seed</code>{" "}
              on the server, then reload this page.
            </div>
          ) : null}

          {note ? (
            <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-blue">
              <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin" aria-hidden />
              {note}
            </p>
          ) : null}
          {error ? (
            <p className="mt-4 flex items-start gap-2 rounded-lg border border-rust/25 bg-rust-soft/60 p-3 text-xs leading-5 text-rust">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}

          <div className="mt-7 flex flex-wrap items-center gap-2 border-t border-line pt-5">
            <TokenChip />
            <span className="text-[10px] text-muted">
              Testnet only. The demo token is not USDC.
            </span>
          </div>

          <div className="mt-5 text-xs text-muted">
            Merchant?{" "}
            <Link
              href="/merchant/login"
              className="font-medium text-ink underline underline-offset-2"
            >
              Open the merchant dashboard
            </Link>
          </div>
        </div>
      </div>

      <div className="relative hidden overflow-hidden border-l border-ink bg-ink p-10 text-paper lg:flex lg:flex-col lg:justify-between">
        <div className="scanline pointer-events-none absolute inset-0 opacity-40" aria-hidden />
        <div className="relative">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-paper/50">
              Vault preview
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-lime">
              <span className="h-1.5 w-1.5 rounded-full bg-lime animate-pulse-dot" />
              Policy v7 active
            </span>
          </div>

          <div className="mt-10 rounded-2xl border border-paper/15 bg-paper/[0.04] p-5">
            <div className="label !text-paper/45">Remaining this month</div>
            <div className="mt-2 font-serif text-6xl leading-none">$187.50</div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-paper/15">
              <div className="h-full w-[62%] rounded-full bg-lime" />
            </div>
            <div className="mt-2 flex justify-between font-mono text-[9px] uppercase tracking-[0.1em] text-paper/45">
              <span>$312.50 spent + held</span>
              <span>$500.00 cap</span>
            </div>

            <div className="mt-6 space-y-2">
              {[
                ["Northstar Compute", "$3.50", "allowed"],
                ["DataForge", "$12.00", "allowed"],
                ["Lighthouse Research", "$24.00", "approval"],
                ["Atlas Data Co.", "$4.50", "denied"],
              ].map(([merchant, amount, state]) => (
                <div
                  key={merchant}
                  className="flex items-center justify-between rounded-lg border border-paper/10 px-3 py-2"
                >
                  <div>
                    <div className="text-xs text-paper/85">{merchant}</div>
                    <div className="font-mono text-[8px] uppercase tracking-[0.12em] text-paper/35">
                      {state === "allowed"
                        ? "allowlisted · settled"
                        : state === "approval"
                          ? "human approval"
                          : "not allowlisted"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-paper/80">{amount}</span>
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        state === "allowed"
                          ? "bg-lime"
                          : state === "approval"
                            ? "bg-amber"
                            : "bg-rust"
                      }`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="relative mt-10">
          <div className="flex items-start gap-3 rounded-xl border border-paper/10 p-4">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-lime" aria-hidden />
            <p className="text-xs leading-5 text-paper/60">
              The vault contract holds the funds. An agent gets a function-call key that can call{" "}
              <span className="font-mono text-paper/85">pay</span> and nothing else. The payout
              destination is pinned in contract state, not chosen by the agent.
            </p>
          </div>
          <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.16em] text-paper/30">
            AgentSpend · NEAR testnet · 2026
          </p>
        </div>
      </div>
    </div>
  );
}
