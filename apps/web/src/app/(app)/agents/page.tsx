import { requireUserPage } from "@/lib/server-auth";
import { listAgents } from "@/lib/agents";
import { vaultForUser } from "@/lib/platform";
import { PageHeader, Callout } from "@/components/ui";
import { AgentsPanel } from "@/components/agents-panel";

export const metadata = { title: "Agents" };
export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const { user, session } = await requireUserPage();
  const agents = await listAgents(user.id);
  const vault = await vaultForUser(user.id);

  return (
    <div className="space-y-7">
      <PageHeader
        kicker="Signing identities"
        title={
          <>
            Give the agent a <span className="font-serif font-normal italic">key</span>, not the
            vault.
          </>
        }
        description="An agent key is scoped to one method on one vault. It can request payments inside the policy; it cannot withdraw, redirect a payout, or change a limit."
      />

      <Callout tone={vault?.rail === "testnet" ? "lime" : "blue"} title="What the agent key can do">
        {vault?.rail === "testnet"
          ? "The on-chain key is a function-call key for pay() only. Revoking the agent deletes that key first, so the chain stops accepting its signature before the dashboard changes."
          : "This workspace uses the mock rail. The bearer token is checked by the backend; there is no on-chain key and no chain-enforced limit."}
      </Callout>

      <AgentsPanel agents={agents} csrf={session.csrf} rail={vault?.rail ?? null} />
    </div>
  );
}
