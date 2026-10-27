import { ApiError, ok, withApi } from "@/lib/api";
import { requireCsrfApi } from "@/lib/server-auth";
import { syncVaultBalance, vaultForUser, vaultTokenBalance } from "@/lib/platform";

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    const { user } = await requireCsrfApi(request);
    const vault = vaultForUser(user.id);
    if (!vault) throw new ApiError(404, "VAULT_NOT_FOUND", "No vault exists for this account.");
    if (vault.rail !== "testnet") {
      return ok({
        balance: vault.balance,
        chainBalance: null,
        rail: vault.rail,
        note: "Mock rail balances are local records, not chain state.",
      });
    }
    const accounted = await syncVaultBalance(vault.id);
    const chainBalance = await vaultTokenBalance(vault);
    return ok({
      balance: accounted.toString(),
      chainBalance: chainBalance?.toString() ?? null,
      rail: vault.rail,
    });
  });
}
