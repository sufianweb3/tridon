import { ok, withApi } from "@/lib/api";
import { agentFromBearer } from "@/lib/auth";
import {
  approvalModeLabel,
  loadPolicyForAgent,
  policySummary,
  unknownModeLabel,
} from "@/lib/policy-service";
import { vaultById } from "@/lib/platform";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const agent = agentFromBearer(request);
    const policy = loadPolicyForAgent(agent.agentId);
    if (!policy) {
      return ok({ policy: null, note: "This agent has no active policy. Payments will be denied." });
    }
    const vault = policy.row.vault_id ? vaultById(policy.row.vault_id) : null;
    return ok({
      policy: {
        id: policy.row.id,
        name: policy.row.name,
        status: policy.row.status,
        version: policy.row.version,
        totalBudget: policy.row.total_budget,
        perTxLimit: policy.row.per_tx_limit,
        dailyLimit: policy.row.daily_limit,
        weeklyLimit: policy.row.weekly_limit,
        monthlyLimit: policy.row.monthly_limit,
        unknownMerchantMode: policy.row.unknown_merchant_mode,
        unknownMerchantModeLabel: unknownModeLabel(policy.row.unknown_merchant_mode),
        unknownMerchantCap: policy.row.unknown_merchant_cap,
        approvalMode: policy.row.approval_mode,
        approvalModeLabel: approvalModeLabel(policy.row.approval_mode),
        validFrom: policy.row.valid_from,
        expiresAt: policy.row.expires_at,
        summary: policySummary(policy),
        allowlistedMerchants: policy.rules
          .filter((rule) => rule.active === 1 && rule.allowlisted === 1)
          .map((rule) => rule.merchant_id),
      },
      enforcement:
        vault?.rail === "testnet"
          ? {
              layer: "on-chain",
              vault: vault.account_id,
              note: "The vault contract rejects payments outside this policy. The backend repeats the check.",
            }
          : {
              layer: "application-backend",
              vault: vault?.account_id ?? null,
              note: "This is the mock rail. Limits are enforced by the backend only.",
            },
    });
  });
}
