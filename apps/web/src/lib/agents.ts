import { generateKey } from "@agentspend/near";
import { ApiError } from "./api";
import { audit } from "./audit";
import { encryptSecret, hashToken, randomId, randomToken, tokenPrefix } from "./crypto";
import { getDb, now, withTransaction } from "./db";
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

export function getAgentRow(agentId: string): AgentRow | null {
  const row = getDb().prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as
    | AgentRow
    | undefined;
  return row ?? null;
}

export function getAgentForUser(agentId: string, userId: string): AgentRow | null {
  const row = getDb()
    .prepare("SELECT * FROM agents WHERE id = ? AND user_id = ?")
    .get(agentId, userId) as AgentRow | undefined;
  return row ?? null;
}

export function listAgentRows(userId: string): AgentRow[] {
  return getDb()
    .prepare("SELECT * FROM agents WHERE user_id = ? ORDER BY created_at ASC")
    .all(userId) as unknown as AgentRow[];
}

function credentialsFor(agentId: string): CredentialRow[] {
  const rows = getDb()
    .prepare(
      `SELECT id, agent_id, prefix, created_at, last_used_at, revoked_at
       FROM agent_credentials WHERE agent_id = ? ORDER BY created_at DESC`,
    )
    .all(agentId) as unknown as CredentialRow[];
  // node:sqlite returns null-prototype rows. Copy them into plain objects before
  // they cross the server/client boundary.
  return rows.map((row) => ({
    id: row.id,
    agent_id: row.agent_id,
    prefix: row.prefix,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
  }));
}

function budgetFor(agent: AgentRow): AgentBudgetView | null {
  if (!agent.vault_id) return null;
  const policy = loadPolicyForVault(agent.vault_id);
  if (!policy) return null;
  const summary = budgetSummary({
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

export function agentView(agent: AgentRow): AgentView {
  const vault = agent.vault_id
    ? (getDb().prepare("SELECT rail FROM vaults WHERE id = ?").get(agent.vault_id) as
        | { rail: string }
        | undefined)
    : undefined;
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
    budget: budgetFor(agent),
    credentials: credentialsFor(agent.id),
  };
}

export function listAgents(userId: string): AgentView[] {
  return listAgentRows(userId).map(agentView);
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

export function createAgentCredential(agentId: string): {
  raw: string;
  prefix: string;
  id: string;
} {
  const agent = getAgentRow(agentId);
  if (!agent) throw new ApiError(404, "AGENT_NOT_FOUND", "Agent not found.");
  if (agent.status !== "active") {
    throw new ApiError(403, "AGENT_REVOKED", "A revoked agent cannot receive a new credential.");
  }
  const raw = randomToken("asp_agent_", 32);
  const prefix = tokenPrefix(raw);
  const id = randomId("cred_");
  getDb()
    .prepare(
      `INSERT INTO agent_credentials (id, agent_id, token_hash, prefix, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, agentId, hashToken(raw), prefix, now());
  return { raw, prefix, id };
}

export async function createAgent(input: {
  userId: string;
  name: string;
  description?: string | null;
}): Promise<CreateAgentResult> {
  const name = normaliseName(input.name);
  const description = (input.description ?? "").trim().slice(0, 240);
  const vault = vaultForUser(input.userId);
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

  withTransaction(() => {
    getDb()
      .prepare(
        `INSERT INTO agents (id, user_id, vault_id, name, description, status, public_key,
          key_ciphertext, key_iv, key_tag, allowance_yocto, created_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
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
      );
    audit({
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
      withTransaction(() => {
        getDb().prepare("DELETE FROM agents WHERE id = ?").run(agentId);
        audit({
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

  const credential = createAgentCredential(agentId);
  audit({
    userId: input.userId,
    actor: "user",
    eventType: "credential.created",
    detail: { agentId, credentialId: credential.id, prefix: credential.prefix },
  });

  const agent = getAgentRow(agentId)!;
  return { agent: agentView(agent), credential, onChainKeyAdded };
}

export async function rotateAgentCredential(input: {
  userId: string;
  agentId: string;
}): Promise<{ credential: { raw: string; prefix: string; id: string } }> {
  const agent = getAgentForUser(input.agentId, input.userId);
  if (!agent) throw new ApiError(404, "AGENT_NOT_FOUND", "Agent not found.");
  if (agent.status !== "active") {
    throw new ApiError(403, "AGENT_REVOKED", "This agent has been revoked.");
  }
  const credential = withTransaction(() => {
    getDb()
      .prepare(
        "UPDATE agent_credentials SET revoked_at = ? WHERE agent_id = ? AND revoked_at IS NULL",
      )
      .run(now(), input.agentId);
    const created = createAgentCredential(input.agentId);
    audit({
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
  const agent = getAgentForUser(input.agentId, input.userId);
  if (!agent) throw new ApiError(404, "AGENT_NOT_FOUND", "Agent not found.");
  if (agent.status === "revoked") {
    return { agent: agentView(agent), releasedPayments: 0 };
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

  const releasedPayments = withTransaction(() => {
    getDb()
      .prepare("UPDATE agents SET status = 'revoked', revoked_at = ? WHERE id = ?")
      .run(now(), agent.id);
    getDb()
      .prepare(
        "UPDATE agent_credentials SET revoked_at = ? WHERE agent_id = ? AND revoked_at IS NULL",
      )
      .run(now(), agent.id);

    // Anything still waiting on a human cannot become valid after revocation.
    const pending = getDb()
      .prepare(
        `SELECT pr.id FROM payment_requests pr
         WHERE pr.agent_id = ? AND pr.status IN ('authorized', 'awaiting_approval', 'submitted')`,
      )
      .all(agent.id) as unknown as Array<{ id: string }>;
    for (const row of pending) {
      getDb()
        .prepare(
          "UPDATE payment_requests SET status = 'expired', deny_code = 'AGENT_REVOKED', deny_message = 'The agent was revoked before settlement.', updated_at = ? WHERE id = ?",
        )
        .run(now(), row.id);
      getDb()
        .prepare(
          "UPDATE budget_reservations SET status = 'released', released_at = ? WHERE payment_id = ? AND status = 'held'",
        )
        .run(now(), row.id);
      getDb()
        .prepare(
          "UPDATE approvals SET status = 'expired', decided_at = ? WHERE payment_id = ? AND status = 'pending'",
        )
        .run(now(), row.id);
      audit({
        userId: input.userId,
        paymentId: row.id,
        actor: "user",
        eventType: "payment.expired_on_revocation",
        detail: {},
      });
    }

    audit({
      userId: input.userId,
      actor: "user",
      eventType: "agent.revoked",
      detail: { agentId: agent.id, releasedPayments: pending.length },
    });
    return pending.length;
  });

  return { agent: agentView(getAgentRow(agent.id)!), releasedPayments };
}

export function vaultForAgentRow(agent: AgentRow): VaultRow | null {
  if (!agent.vault_id) return null;
  return (
    (getDb().prepare("SELECT * FROM vaults WHERE id = ?").get(agent.vault_id) as
      | VaultRow
      | undefined) ?? null
  );
}
