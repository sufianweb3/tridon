import { z } from "zod";
import { ok, readJson, withApi } from "@/lib/api";
import { policyForUser, policyView, updatePolicy } from "@/lib/policies";
import { requireCsrfApi, requireUserApi } from "@/lib/server-auth";
import {
  decimalSchema,
  decimalToUnits,
  decimalToUnitsAllowZero,
} from "@/lib/validation";

export const dynamic = "force-dynamic";

const ruleSchema = z.object({
  merchantId: z.string().min(1).max(64),
  allowlisted: z.boolean(),
  perTxLimit: decimalSchema,
  windowLimit: decimalSchema,
  windowSecs: z.number().int().min(0).max(30 * 24 * 60 * 60),
  requiresApproval: z.boolean(),
});

const schema = z.object({
  name: z.string().min(2).max(64),
  totalBudget: decimalSchema,
  perTxLimit: decimalSchema,
  dailyLimit: decimalSchema,
  weeklyLimit: decimalSchema,
  monthlyLimit: decimalSchema,
  unknownMerchantMode: z.enum(["deny", "require_approval", "allow_with_cap"]),
  unknownMerchantCap: decimalSchema,
  approvalMode: z.enum(["all", "none_within_policy", "selected_merchants", "unknown_merchants"]),
  rules: z.array(ruleSchema).max(32),
});

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const { user } = await requireUserApi(request);
    const policy = policyForUser(user.id);
    return ok({ policy: policy ? policyView(policy) : null });
  });
}

export async function PATCH(request: Request): Promise<Response> {
  return withApi(async () => {
    const { user } = await requireCsrfApi(request);
    const body = await readJson(request, schema);
    const result = await updatePolicy({
        userId: user.id,
        spec: {
          name: body.name,
          totalBudget: decimalToUnits(body.totalBudget, "Total budget"),
          perTxLimit: decimalToUnits(body.perTxLimit, "Per-payment limit"),
          dailyLimit: decimalToUnitsAllowZero(body.dailyLimit, "Daily limit"),
          weeklyLimit: decimalToUnitsAllowZero(body.weeklyLimit, "Weekly limit"),
          monthlyLimit: decimalToUnitsAllowZero(body.monthlyLimit, "Monthly limit"),
          unknownMerchantMode: body.unknownMerchantMode,
          unknownMerchantCap: decimalToUnitsAllowZero(
            body.unknownMerchantCap,
            "Unknown merchant cap",
          ),
          approvalMode: body.approvalMode,
          rules: body.rules.map((rule) => ({
            merchantId: rule.merchantId,
            allowlisted: rule.allowlisted,
            perTxLimit: decimalToUnitsAllowZero(rule.perTxLimit, "Merchant per-payment limit"),
            windowLimit: decimalToUnitsAllowZero(rule.windowLimit, "Merchant window limit"),
            windowSecs: rule.windowSecs,
            requiresApproval: rule.requiresApproval,
          })),
        },
      });
    return ok(result);
  });
}
