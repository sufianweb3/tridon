import { ok, withApi } from "@/lib/api";
import { agentFromBearer } from "@/lib/auth";
import { budgetForAgent } from "@/lib/payments";
import { loadPolicyForAgent } from "@/lib/policy-service";
import { usageForPolicy } from "@/lib/usage";
import { now } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const agent = await agentFromBearer(request);
    const budget = await budgetForAgent(agent.agentId);
    const policy = await loadPolicyForAgent(agent.agentId);
    if (!budget || !policy) {
      return ok({ budget: null, note: "No active budget for this agent." });
    }
    const usage = await usageForPolicy({
      policyId: policy.row.id,
      now: now(),
      merchantId: "",
      windowSecs: 0,
    });
    return ok({
      budget: {
        policyId: budget.policyId,
        totalBudget: budget.totalBudget.toString(),
        remaining: budget.remaining.toString(),
        committed: budget.committed.toString(),
        held: budget.held.toString(),
        balance: budget.balance.toString(),
        available: budget.available.toString(),
        dayGross: usage.dayGross.toString(),
        weekGross: usage.weekGross.toString(),
        monthGross: usage.monthGross.toString(),
      },
      unit: "base units (6 decimals)",
      note: "Held amounts include in-flight and approval-pending payments. Released reservations are not counted.",
    });
  });
}
