import { parseUnits } from "@agentspend/core";
import { execute, now, query, queryOne } from "./db";

export interface MerchantSeed {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  accent: string;
  payoutAccount: string;
  services: Array<{
    id: string;
    name: string;
    description: string;
    price: string;
  }>;
}

/**
 * The platform merchant catalogue. Payout accounts are placeholder testnet
 * names for the mock rail; the live testnet setup replaces them with accounts
 * that actually exist and are storage-registered for the demo token.
 */
export const MERCHANTS: MerchantSeed[] = [
  {
    id: "merchant-data",
    name: "DataForge",
    slug: "dataforge",
    category: "Market data",
    description: "Structured market and on-chain datasets for research agents.",
    accent: "lime",
    payoutAccount: "as-payout-data.testnet",
    services: [
      {
        id: "svc-data-market",
        name: "Market dataset API",
        description: "One paginated dataset call with 30 days of history.",
        price: "12.000000",
      },
    ],
  },
  {
    id: "merchant-api",
    name: "Relay API",
    slug: "relay",
    category: "Model API",
    description: "Low-latency inference credits for autonomous workflows.",
    accent: "blue",
    payoutAccount: "as-payout-api.testnet",
    services: [
      {
        id: "svc-api-inference",
        name: "Inference credits",
        description: "One million tokens on the Relay small model.",
        price: "8.000000",
      },
    ],
  },
  {
    id: "merchant-compute",
    name: "Northstar Compute",
    slug: "northstar",
    category: "Compute",
    description: "On-demand GPU minutes for agent evaluation jobs.",
    accent: "violet",
    payoutAccount: "as-payout-compute.testnet",
    services: [
      {
        id: "svc-compute-gpu",
        name: "GPU minute",
        description: "One reserved minute on an L4 worker.",
        price: "3.500000",
      },
    ],
  },
  {
    id: "merchant-research",
    name: "Lighthouse Research",
    slug: "lighthouse",
    category: "Research",
    description: "Human-reviewed research briefs with source links.",
    accent: "amber",
    payoutAccount: "as-payout-research.testnet",
    services: [
      {
        id: "svc-research-brief",
        name: "Deep research brief",
        description: "A cited 2,000-word brief, delivered in 24 hours.",
        price: "24.000000",
      },
    ],
  },
  {
    id: "merchant-atlas",
    name: "Atlas Data Co.",
    slug: "atlas",
    category: "Market data",
    description: "Long-tail data vendor. Not on the default allowlist.",
    accent: "rust",
    payoutAccount: "as-payout-atlas.testnet",
    services: [
      {
        id: "svc-atlas-feed",
        name: "Alternative data feed",
        description: "One historical alternative-data query.",
        price: "4.500000",
      },
    ],
  },
  {
    id: "merchant-fail",
    name: "Flaky Fulfillment",
    slug: "flaky",
    category: "Failure test",
    description:
      "Deliberately broken payout for the failure-path demo. The merchant account is not registered for the token, so the token transfer fails and the vault releases the reservation with no fee.",
    accent: "rust",
    payoutAccount: "as-payout-fail.testnet",
    services: [
      {
        id: "svc-fail-test",
        name: "Failure-path probe",
        description: "A $1.00 payment that fails at settlement, proving no fee is charged.",
        price: "1.000000",
      },
    ],
  },
];

export async function ensureMerchants(): Promise<void> {
  const timestamp = now();
  for (const merchant of MERCHANTS) {
    await execute(
      `INSERT INTO merchants (id, name, slug, payout_account, category, description, accent, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         slug = excluded.slug,
         category = excluded.category,
         description = excluded.description,
         accent = excluded.accent,
         active = 1`,
      [
        merchant.id,
        merchant.name,
        merchant.slug,
        merchant.payoutAccount,
        merchant.category,
        merchant.description,
        merchant.accent,
        timestamp,
      ],
    );
    for (const service of merchant.services) {
      await execute(
        `INSERT INTO merchant_services (id, merchant_id, name, description, price, asset, network, active, created_at)
         VALUES (?, ?, ?, ?, ?, 'TESTUSD', 'testnet', 1, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           price = excluded.price,
           active = 1`,
        [
          service.id,
          merchant.id,
          service.name,
          service.description,
          parseUnits(service.price).toString(),
          timestamp,
        ],
      );
    }
  }
}

export async function merchantById(id: string): Promise<MerchantSeed | null> {
  const row = await queryOne<{ payout_account: string }>(
    "SELECT payout_account FROM merchants WHERE id = ?",
    [id],
  );
  if (!row) return null;
  const seed = MERCHANTS.find((merchant) => merchant.id === id);
  if (!seed) return null;
  return { ...seed, payoutAccount: row.payout_account };
}

export async function merchantServices(merchantId: string): Promise<Array<{
  id: string;
  name: string;
  description: string;
  price: string;
  asset: string;
  network: string;
}>> {
  return query(
    "SELECT * FROM merchant_services WHERE merchant_id = ? AND active = 1 ORDER BY price",
    [merchantId],
  );
}
