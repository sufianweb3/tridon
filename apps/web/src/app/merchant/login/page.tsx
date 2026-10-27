import { redirect } from "next/navigation";
import { currentMerchant } from "@/lib/server-auth";
import { appConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { MerchantLogin, type MerchantChoice } from "@/components/merchant-login";

export const metadata = { title: "Merchant sign in" };
export const dynamic = "force-dynamic";

export default async function MerchantLoginPage() {
  const session = await currentMerchant();
  if (session) redirect("/merchant/dashboard");

  const merchants = getDb()
    .prepare(
      "SELECT id, name, category, description, payout_account FROM merchants WHERE active = 1 ORDER BY name",
    )
    .all() as unknown as Array<{
    id: string;
    name: string;
    category: string;
    description: string;
    payout_account: string;
  }>;

  const choices: MerchantChoice[] = merchants.map((merchant) => ({
    id: merchant.id,
    name: merchant.name,
    category: merchant.category,
    description: merchant.description,
    payoutAccount: merchant.payout_account,
  }));

  return <MerchantLogin merchants={choices} demoEnabled={appConfig.demoEnabled} />;
}
