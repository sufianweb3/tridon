import Link from "next/link";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { requireUserPage } from "@/lib/server-auth";
import { policyForUser, policyView } from "@/lib/policies";
import { query } from "@/lib/db";
import { vaultForUser } from "@/lib/platform";
import { shortAccount } from "@/lib/format";
import { Callout, EmptyState, PageHeader, RailBadge } from "@/components/ui";
import { PolicyEditor, type MerchantOption } from "@/components/policy-editor";

export const metadata = { title: "Policy" };
export const dynamic = "force-dynamic";

export default async function PolicyPage() {
  const { user, session } = await requireUserPage();
  const policy = await policyForUser(user.id);
  const vault = await vaultForUser(user.id);

  if (!policy) {
    return (
      <div className="space-y-7">
        <PageHeader
          kicker="Policy"
          title={
            <>
              Every payment needs a <span className="font-serif font-normal italic">rule</span>.
            </>
          }
        />
        <EmptyState
          title="No policy is attached to this workspace."
          body="Provision a vault first. The policy is the only thing that decides whether an agent payment can move money."
          action={
            <Link href="/dashboard" className="btn btn-primary !px-4 !py-2 !text-xs">
              Back to the control room
            </Link>
          }
        />
      </div>
    );
  }

  const view = await policyView(policy);
  const rulesById = new Map(view.rules.map((rule) => [rule.merchantId, rule]));
  const merchants = await query<{
    id: string;
    name: string;
    category: string;
    payout_account: string;
  }>("SELECT id, name, category, payout_account FROM merchants WHERE active = 1 ORDER BY name");
  const options: MerchantOption[] = merchants.map((merchant) => {
    const rule = rulesById.get(merchant.id);
    return {
      id: merchant.id,
      name: merchant.name,
      category: merchant.category,
      payoutAccount: merchant.payout_account,
      perTxLimit: rule?.perTxLimit ?? "0",
      windowLimit: rule?.windowLimit ?? "0",
      windowSecs: rule?.windowSecs ?? 0,
      allowlisted: rule?.allowlisted ?? false,
      requiresApproval: rule?.requiresApproval ?? false,
    };
  });

  return (
    <div className="space-y-7">
      <PageHeader
        kicker="Policy"
        title={
          <>
            One policy. Every <span className="font-serif font-normal italic">agent</span>.
          </>
        }
        description="These are the only numbers an agent can spend against. Changes are written locally first, then synced to the vault contract; a failed sync pauses the policy rather than leaving it open."
        actions={
          <>
            <RailBadge rail={vault?.rail ?? "mock"} />
            {vault ? (
              <a
                href={`https://testnet.nearblocks.io/account/${vault.account_id}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost !px-3 !py-1.5 !text-xs"
              >
                {shortAccount(vault.account_id)}
                <ArrowUpRight className="h-3 w-3" aria-hidden />
              </a>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 md:grid-cols-3">
        <Callout
          tone={vault?.rail === "testnet" ? "lime" : "blue"}
          title={vault?.rail === "testnet" ? "On-chain enforcement" : "Backend enforcement"}
        >
          {vault?.rail === "testnet"
            ? "The vault contract checks the budget, per-payment cap, merchant payout and allowlist before it transfers a single base unit."
            : "This workspace uses the mock rail. The backend checks every rule below; there is no chain transaction and no on-chain guarantee."}
        </Callout>
        <Callout tone="paper" title="Deterministic, not generative">
          An LLM may decide to ask for a payment. It never decides whether the payment is allowed.
          The policy engine is a pure function over integers.
        </Callout>
        <Callout tone="paper" title="Fails closed">
          A missing rule, an expired policy, a revoked agent or an unknown settlement all resolve
          to “not paid”. The platform cannot waive a limit.
        </Callout>
      </div>

      <PolicyEditor policy={view} merchants={options} csrf={session.csrf} />

      <div className="flex items-start gap-2 border-t border-line pt-4 text-[10px] leading-5 text-muted">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green" aria-hidden />
        Merchant payout accounts are pinned in vault state and are never supplied by the agent.
        Unknown means “not allowlisted here”, never “send it anywhere”.
      </div>
    </div>
  );
}
