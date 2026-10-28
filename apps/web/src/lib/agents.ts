import { generateKey } from "@agentspend/near";
import { ApiError } from "./api";
import { audit } from "./audit";
import { encryptSecret, hashToken, randomId, randomToken, tokenPrefix } from "./crypto";
import { execute, now, query, queryOne, withTransaction } from "./db";
import { budgetSummary } from "./usage";
import { loadPolicyForVault } from "./policy-service";
import {
  addAgentKeyToVault,
  revokeAgentOnVault,
  vaultForUser,
  type VaultRow,
} from "./platform";

export interface AgentRow {
  id: string;
  user_id: string;
  vault_id: string | null;
  name: string;
  description: string | null;
  status: string;
  public_key: string | null;
  key_ciphertext: string | null;
  key_iv: string | null;
  key_tag: string | null;
  allowance_yocto: string | null;
  created_at: number;
  revoked_at: number | null;
}

export interface CredentialRow {
  id: string;
  agent_id: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

export interface AgentBudgetView {
  totalBudget: string;
  remaining: string;
  committed: string;
  held: string;
  balance: string;
  available: string;
  perTxLimit: string;
  dailyLimit: string;
  policyId: string;
  policyVersion: number;
  policyStatus: string;
}

export interface AgentView {
  id: string;
  name: string;
  description: string | null;
  status: string;
  publicKey: string | null;
  createdAt: number;
  revokedAt: number | null;
  vaultId: string | null;
  rail: string | null;
  budget: AgentBudgetView | null;
  credentials: CredentialRow[];
}

export async function getAgentRow(agentId: string): Promise<AgentRow | null> {
  return queryOne<AgentRow>("SELECT * FROM agents WHERE id = ?", [agentId]);
}

export async function getAgentForUser(agentId: string, userId: string): Promise<AgentRow | null> {
  return queryOne<AgentRow>("SELECT * FROM agents WHERE id = ? AND user_id = ?", [agentId, userId]);
}

export async function listAgentRows(userId: string): Promise<AgentRow[]> {
  return query<AgentRow>("SELECT * FROM agents WHERE user_id = ? ORDER BY created_at ASC", [userId]);
}

async function credentialsFor(agentId: string): Promise<CredentialRow[]> {
  const rows = await query<CredentialRow>(
    `SELECT id, agent_id, prefix, created_at, last_used_at, revoked_at
     FROM agent_credentials WHERE agent_id = ? ORDER BY created_at DESC`,
    [agentId],
  );
  return rows.map((row) => ({
    id: row.id,
    agent_id: row.agent_id,
    prefix: row.prefix,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
  }));
}

async function budgetFor(agent: AgentRow): Promise<AgentBudgetView | null> {
  if (!agent.vault_id) return null;
  const policy = await loadPolicyForVault(agent.vault_id);
  if (!policy) return null;
  const summary = await budgetSummary({
    policyId: policy.row.id,
    totalBudget: BigInt(policy.row.total_budget),
    now: now(),
  });
  return {
    totalBudget: summary.totalBudget.toString(),
    remaining: summary.remaining.toString(),
    committed: summary.committedGross.toString(),
    held: summary.heldGross.toString(),
    balance: summary.balance.toString(),
    available: summary.availableBalance.toString(),
    perTxLimit: policy.row.per_tx_limit,
    dailyLimit: policy.row.daily_limit,
    policyId: policy.row.id,
    policyVersion: policy.row.version,
    policyStatus: policy.row.status,
  };
}

export async function agentView(agent: AgentRow): Promise<AgentView> {
  const vault = agent.vault_id
    ? await queryOne<{ rail: string }>("SELECT rail FROM vaults WHERE id = ?", [agent.vault_id])
    : null;
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    status: agent.status,
    publicKey: agent.public_key,
    createdAt: agent.created_at,
    revokedAt: agent.revoked_at,
    vaultId: agent.vault_id,
    rail: vault?.rail ?? null,
    budget: await budgetFor(agent),
    credentials: await credentialsFor(agent.id),
  };
}

export async function listAgents(userId: string): Promise<AgentView[]> {
  const rows = await listAgentRows(userId);
  return Promise.all(rows.map(agentView));
}

export interface CreateAgentResult {
  agent: AgentView;
  credential: { raw: string; prefix: string; id: string };
  onChainKeyAdded: boolean;
}

function normaliseName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 64) {
    throw new ApiError(400, "INVALID_AGENT_NAME", "Agent name must be 2-64 characters.");
  }
  return trimmed;
}

export async function createAgentCredential(agentId: string): Promise<{
  raw: string;
  prefix: string;
  id: string;
}> {
  const agent = await getAgentRow(agentId);
  if (!agent) throw new ApiError(404, "AGENT_NOT_FOUND", "Agent not found.");
  if (agent.status !== "active") {
    throw new ApiError(403, "AGENT_REVOKED", "A revoked agent cannot receive a new credential.");
  }
  const raw = randomToken("asp_agent_", 32);
  const prefix = tokenPrefix(raw);
  const id = randomId("cred_");
  await execute(
    `INSERT INTO agent_credentials (id, agent_id, token_hash, prefix, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, agentId, hashToken(raw), prefix, now()],
  );
  return { raw, prefix, id };
}

export async function createAgent(input: {
  userId: string;
  name: string;
  description?: string | null;
}): Promise<CreateAgentResult> {
  const name = normaliseName(input.name);
  const description = (input.description ?? "").trim().slice(0, 240);
  const vault = await vaultForUser(input.userId);
  if (!vault) {
    throw new ApiError(
      409,
      "VAULT_NOT_FOUND",
      "No vault exists for this account yet. Sign in again to provision one.",
    );
  }
  if (vault.rail === "testnet" && vault.chain_status !== "ready") {
    throw new ApiError(
      409,
      "VAULT_NOT_READY",
      "The live vault is not ready. No agent key was created.",
    );
  }

  const agentId = randomId("agent_");
  const key = vault.rail === "testnet" ? generateKey() : null;
  const encrypted = key ? encryptSecret(key.secretKey) : null;

  await withTransaction(async () => {
    await execute(
      `INSERT INTO agents (id, user_id, vault_id, name, description, status, public_key,
        key_ciphertext, key_iv, key_tag, allowance_yocto, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
      [
        agentId,
        input.userId,
        vault.id,
        name,
        description,
        key?.publicKey ?? null,
        encrypted?.ciphertext ?? null,
        encrypted?.iv ?? null,
        encrypted?.tag ?? null,
        key ? "500000000000000000000000" : null,
        now(),
      ],
    );
    await audit({
      userId: input.userId,
      actor: "user",
      eventType: "agent.created",
      detail: { agentId, name, rail: vault.rail },
    });
  });

  let onChainKeyAdded = false;
  if (key) {
    try {
      await addAgentKeyToVault({ vault, agentId, publicKey: key.publicKey });
      onChainKeyAdded = true;
    } catch (error) {
      await withTransaction(async () => {
        await execute("DELETE FROM agents WHERE id = ?", [agentId]);
        await audit({
          userId: input.userId,
          actor: "system",
          eventType: "agent.create_failed",
          detail: { agentId, error: error instanceof Error ? error.message : "unknown" },
        });
      });
      throw new ApiError(
        502,
        "AGENT_KEY_FAILED",
        error instanceof Error
          ? `The on-chain agent key could not be added: ${error.message}`
          : "The on-chain agent key could not be added.",
      );
    }
  }

  const credential = await createAgentCredential(agentId);
  await audit({
    userId: input.userId,
    actor: "user",
    eventType: "credential.created",
    detail: { agentId, credentialId: credential.id, prefix: credential.prefix },
  });

  const agent = await getAgentRow(agentId);
  if (!agent) throw new Error("agent disappeared after creation");
  return { agent: await agentView(agent), credential, onChainKeyAdded };
}

export async function rotateAgentCredential(input: {
  userId: string;
  agentId: string;
}): Promise<{ credential: { raw: string; prefix: string; id: string } }> {
  const agent = await getAgentForUser(input.agentId, input.userId);
  if (!agent) throw new ApiError(404, "AGENT_NOT_FOUND", "Agent not found.");
  if (agent.status !== "active") {
    throw new ApiError(403, "AGENT_REVOKED", "This agent has been revoked.");
  }
  const credential = await withTransaction(async () => {
    await execute(
      "UPDATE agent_credentials SET revoked_at = ? WHERE agent_id = ? AND revoked_at IS NULL",
      [now(), input.agentId],
    );
    const created = await createAgentCredential(input.agentId);
    await audit({
      userId: input.userId,
      actor: "user",
      eventType: "credential.rotated",
      detail: { agentId: input.agentId, credentialId: created.id },
    });
    return created;
  });
  return { credential };
}

export async function revokeAgent(input: {
  userId: string;
  agentId: string;
}): Promise<{ agent: AgentView; releasedPayments: number }> {
  const agent = await getAgentForUser(input.agentId, input.userId);
  if (!agent) throw new ApiError(404, "AGENT_NOT_FOUND", "Agent not found.");
  if (agent.status === "revoked") {
    return { agent: await agentView(agent), releasedPayments: 0 };
  }

  // Chain first: the function-call key is the real authority. If this fails we
  // leave the agent active rather than pretending it was revoked.
  try {
    await revokeAgentOnVault(agent.id);
  } catch (error) {
    throw new ApiError(
      502,
      "AGENT_REVOKE_FAILED",
      error instanceof Error
        ? `The on-chain key was not revoked: ${error.message}`
        : "The on-chain key was not revoked.",
    );
  }

  const releasedPayments = await withTransaction(async () => {
    await execute("UPDATE agents SET status = 'revoked', revoked_at = ? WHERE id = ?", [
      now(),
      agent.id,
    ]);
    await execute(
      "UPDATE agent_credentials SET revoked_at = ? WHERE agent_id = ? AND revoked_at IS NULL",
      [now(), agent.id],
    );

    // Anything still waiting on a human cannot become valid after revocation.
    const pending = await query<{ id: string }>(
      `SELECT pr.id FROM payment_requests pr
       WHERE pr.agent_id = ? AND pr.status IN ('authorized', 'awaiting_approval', 'submitted')`,
      [agent.id],
    );
    for (const row of pending) {
      await execute(
        "UPDATE payment_requests SET status = 'expired', deny_code = 'AGENT_REVOKED', deny_message = 'The agent was revoked before settlement.', updated_at = ? WHERE id = ?",
        [now(), row.id],
      );
      await execute(
        "UPDATE budget_reservations SET status = 'released', released_at = ? WHERE payment_id = ? AND status = 'held'",
        [now(), row.id],
      );
      await execute(
        "UPDATE approvals SET status = 'expired', decided_at = ? WHERE payment_id = ? AND status = 'pending'",
        [now(), row.id],
      );
      await audit({
        userId: input.userId,
        paymentId: row.id,
        actor: "user",
        eventType: "payment.expired_on_revocation",
        detail: {},
      });
    }

    await audit({
      userId: input.userId,
      actor: "user",
      eventType: "agent.revoked",
      detail: { agentId: agent.id, releasedPayments: pending.length },
    });
    return pending.length;
  });

  const fresh = await getAgentRow(agent.id);
  if (!fresh) throw new Error("agent disappeared after revocation");
  return { agent: await agentView(fresh), releasedPayments };
}

export async function vaultForAgentRow(agent: AgentRow): Promise<VaultRow | null> {
  if (!agent.vault_id) return null;
  return queryOne<VaultRow>("SELECT * FROM vaults WHERE id = ?", [agent.vault_id]);
}
