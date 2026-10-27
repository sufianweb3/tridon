import { z } from "zod";
import { ApiError, ok, readJson, withApi } from "@/lib/api";
import { getAgentForUser } from "@/lib/agents";
import { randomId } from "@/lib/crypto";
import { now } from "@/lib/db";
import { createPayment, getApprovalForPayment } from "@/lib/payments";
import { requireCsrfApi } from "@/lib/server-auth";
import { decimalSchema, decimalToUnits } from "@/lib/validation";
import { paymentView } from "@/lib/views";

export const dynamic = "force-dynamic";

const schema = z.object({
  agentId: z.string().min(1).max(64),
  merchantId: z.string().min(1).max(64),
  serviceId: z.string().min(1).max(64).optional(),
  amount: decimalSchema.optional(),
  simulateFailure: z.boolean().optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
});

/**
 * Browser-side agent console.
 *
 * This route exists so a human can exercise the agent API without pasting a
 * bearer token into the page. It authenticates the user session and CSRF token,
 * then creates the payment exactly as the agent API would. It is not a way for
 * an agent to bypass its credential: the bearer API remains the production
 * entry point, and this route is labelled as a demo console in the UI.
 */
export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    const { user } = await requireCsrfApi(request);
    const body = await readJson(request, schema);
    const agent = getAgentForUser(body.agentId, user.id);
    if (!agent) throw new ApiError(404, "AGENT_NOT_FOUND", "Agent not found.");
    if (agent.status !== "active") {
      throw new ApiError(403, "AGENT_REVOKED", "This agent has been revoked.");
    }

    const idempotencyKey = body.idempotencyKey ?? randomId("ui");
    const result = await createPayment({
      userId: user.id,
      agentId: agent.id,
      merchantId: body.merchantId,
      serviceId: body.serviceId ?? null,
      amountGross: body.amount ? BigInt(decimalToUnits(body.amount, "Amount")) : null,
      idempotencyKey,
      requestExpiry: now() + 10 * 60_000,
      simulateFailure: body.simulateFailure ?? false,
      actor: "agent",
    });

    const approval =
      result.approval ?? getApprovalForPayment(result.payment.id) ?? null;
    return ok({
      payment: paymentView(result.payment),
      approval: approval
        ? {
            id: approval.id,
            status: approval.status,
            approvalHash: approval.approval_hash,
            expiresAt: approval.expires_at,
          }
        : null,
      replayed: result.replayed,
      idempotencyKey,
    });
  });
}
