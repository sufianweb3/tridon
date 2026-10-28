import { ok, withApi } from "@/lib/api";
import { query } from "@/lib/db";
import { policyForUser, ruleForMerchant } from "@/lib/policies";
import { requireUserApi } from "@/lib/server-auth";
import { merchantServices } from "@/lib/seed-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const { user } = await requireUserApi(request);
    const policy = await policyForUser(user.id);
    const merchants = await query<{
      id: string;
      name: string;
      slug: string;
      category: string;
      description: string;
      payout_account: string;
      accent: string;
    }>("SELECT * FROM merchants WHERE active = 1 ORDER BY name");
    const rows = await Promise.all(
      merchants.map(async (merchant) => {
        const rule = policy ? ruleForMerchant(policy, merchant.id) : null;
        return {
          id: merchant.id,
          name: merchant.name,
          slug: merchant.slug,
          category: merchant.category,
          description: merchant.description,
          payoutAccount: merchant.payout_account,
          accent: merchant.accent,
          policy: rule
            ? {
                allowlisted: rule.allowlisted === 1,
                active: rule.active === 1,
                perTxLimit: rule.per_tx_limit,
                windowLimit: rule.window_limit,
                windowSecs: rule.window_secs,
                requiresApproval: rule.requires_approval === 1,
              }
            : null,
          services: await merchantServices(merchant.id),
        };
      }),
    );
    return ok({ merchants: rows });
  });
}
