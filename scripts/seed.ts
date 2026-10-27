/**
 * Idempotent demo seed.
 *
 * 1. Provision the live NEAR testnet demo workspace (resumable).
 * 2. Issue agent API credentials once and print them.
 * 3. Run the demo payments that exercise allow / deny / approval / failure.
 *
 * Re-running is safe: every step checks a setting or an idempotency key.
 */
import { createPayment, getPayment, reconcilePayment } from "../apps/web/src/lib/payments";
import { createAgentCredential, listAgentRows } from "../apps/web/src/lib/agents";
import { closeDb, getDb, now, setSetting, setting } from "../apps/web/src/lib/db";
import { ensureDemoWorkspace, syncVaultBalance } from "../apps/web/src/lib/platform";
import { ensureMerchants } from "../apps/web/src/lib/seed-data";
import { hashToken, randomId, randomToken, tokenPrefix } from "../apps/web/src/lib/crypto";

const DAY_MS = 86_400_000;

function line(message: string): void {
  console.log(message);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function settleUnknown(paymentId: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = getPayment(paymentId);
    if (!current) return "missing";
    if (current.status !== "unknown" && current.status !== "submitted" && current.status !== "confirming") {
      return current.status;
    }
    try {
      const next = await reconcilePayment(paymentId);
      if (next.status !== "unknown" && next.status !== "submitted" && next.status !== "confirming") {
        return next.status;
      }
    } catch {
      // keep polling
    }
    await sleep(1_500);
  }
  return getPayment(paymentId)?.status ?? "unknown";
}

async function main(): Promise<void> {
  line("AgentSpend demo seed");
  line("====================");
  ensureMerchants();

  line("\n[1/4] Provisioning the NEAR testnet demo workspace...");
  line("      This creates accounts, deploys the vault + test token, and funds the vault.");
  line("      A resumed run skips completed steps.");
  const workspace = await ensureDemoWorkspace();
  line(`      owner:  ${workspace.ownerAccount}`);
  line(`      vault:  ${workspace.vaultAccount}`);
  line(`      token:  ${workspace.tokenAccount} (TESTUSD, a demo token, not USDC)`);
  line(`      state:  ${workspace.resumed ? "resumed" : "created"}`);

  line("\n[2/4] Syncing the vault balance...");
  const balance = await syncVaultBalance(workspace.vaultId);
  line(`      accounted balance: ${balance.toString()} base units (6 decimals)`);

  line("\n[3/4] Agent API credentials");
  const agents = listAgentRows(workspace.userId);
  for (const agent of agents) {
    const existing = getDb()
      .prepare(
        "SELECT id FROM agent_credentials WHERE agent_id = ? AND revoked_at IS NULL LIMIT 1",
      )
      .get(agent.id) as { id: string } | undefined;
    if (existing) {
      line(`      ${agent.name}: credential already exists (raw value was shown once)`);
      continue;
    }
    const credential = createAgentCredential(agent.id);
    line(`      ${agent.name} (${agent.id})`);
    line(`        bearer: ${credential.raw}`);
  }

  line("\n[4/4] Demo payments");
  interface DemoPayment {
    key: string;
    agentId: string;
    merchantId: string;
    serviceId?: string;
    amountGross?: bigint;
    expect: string;
    label: string;
  }
  const demo: DemoPayment[] = [
    {
      key: "allowed-compute",
      agentId: "agent-research",
      merchantId: "merchant-compute",
      serviceId: "svc-compute-gpu",
      expect: "succeeded",
      label: "Allowed $3.50 GPU minute (live vault)",
    },
    {
      key: "allowed-data",
      agentId: "agent-research",
      merchantId: "merchant-data",
      serviceId: "svc-data-market",
      expect: "succeeded",
      label: "Allowed $12.00 market dataset (live vault)",
    },
    {
      key: "approval-research",
      agentId: "agent-research",
      merchantId: "merchant-research",
      serviceId: "svc-research-brief",
      expect: "awaiting_approval",
      label: "Pending $24.00 research brief (approval required)",
    },
    {
      key: "denied-per-tx",
      agentId: "agent-research",
      merchantId: "merchant-data",
      amountGross: 50_000_000n,
      expect: "denied",
      label: "Denied $50.00 DataForge charge (per-payment cap)",
    },
    {
      key: "denied-unknown",
      agentId: "agent-research",
      merchantId: "merchant-atlas",
      serviceId: "svc-atlas-feed",
      expect: "denied",
      label: "Denied $4.50 Atlas charge (merchant not allowlisted)",
    },
    {
      key: "failed-flaky",
      agentId: "agent-ops",
      merchantId: "merchant-fail",
      serviceId: "svc-fail-test",
      expect: "failed",
      label: "Failed $1.00 Flaky Fulfillment charge (no fee)",
    },
  ];

  for (const item of demo) {
    const flag = `demo.seeded.${item.key}`;
    if (setting(flag, "") === "1") {
      line(`      ${item.label}: already seeded`);
      continue;
    }
    try {
      const result = await createPayment({
        userId: workspace.userId,
        agentId: item.agentId,
        merchantId: item.merchantId,
        serviceId: item.serviceId,
        amountGross: item.amountGross,
        idempotencyKey: `seed-${item.key}-v1`,
        requestExpiry: now() + 45 * 60_000,
        actor: "user",
      });
      let status = result.payment.status;
      if (status === "unknown") status = await settleUnknown(result.payment.id);
      line(
        `      ${item.label}: ${status}${result.replayed ? " (replayed)" : ""} · ${result.payment.id}`,
      );
      if (status === item.expect) {
        setSetting(flag, "1");
      } else if (item.expect === "failed" && status === "unknown") {
        line("        warning: settlement is still unknown; reconcile it from the transaction page");
      } else {
        line(`        warning: expected ${item.expect}, got ${status}`);
      }
    } catch (error) {
      line(`      ${item.label}: FAILED TO SEED`);
      line(`        ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Merchant demo credential for the API docs page.
  const merchantCredential = setting("demo.merchant.credential_id", "");
  if (!merchantCredential) {
    const raw = randomToken("asp_merchant_", 32);
    const id = randomId("mcred_");
    getDb()
      .prepare(
        `INSERT INTO merchant_api_credentials (id, merchant_id, token_hash, prefix, created_at)
         VALUES (?, 'merchant-data', ?, ?, ?)`,
      )
      .run(id, hashToken(raw), tokenPrefix(raw), now());
    setSetting("demo.merchant.credential_id", id);
    line("\nMerchant API credential (DataForge, shown once):");
    line(`  bearer: ${raw}`);
  } else {
    line("\nMerchant API credential already exists (raw value was shown once).");
  }

  line("\nSeed complete.");
  line(`Demo workspace user: ${workspace.userId}`);
  line(`Demo vault: ${workspace.vaultId}`);
  line(`Policy version: ${(getDb().prepare("SELECT version FROM policies WHERE vault_id = ?").get(workspace.vaultId) as { version?: number } | undefined)?.version ?? "?"}`);
  line(`Budget window start: ${new Date(now() - (now() % DAY_MS)).toISOString()}`);
  closeDb();
}

main().catch((error) => {
  console.error("\nSeed failed:");
  console.error(error);
  process.exitCode = 1;
});
