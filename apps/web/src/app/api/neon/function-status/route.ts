import { ApiError, ok, withApi } from "@/lib/api";
import { listAgentRows } from "@/lib/agents";
import { requireUserApi } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/**
 * Proxies a read-only status check to the deployed Neon Function. The shared
 * secret stays on the server; the browser only sees the function's answer.
 */
export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    const { user } = await requireUserApi(request);
    const base = process.env.NEON_FUNCTION_HELLO_BASE_URL;
    const secret = process.env.AGENTSPEND_FUNCTION_SECRET;
    if (!base || !secret) {
      throw new ApiError(
        503,
        "FUNCTION_NOT_CONFIGURED",
        "The Neon Function URL or its shared secret is not configured.",
      );
    }

    const agents = await listAgentRows(user.id);
    const agent = agents[0];
    if (!agent) {
      throw new ApiError(404, "AGENT_NOT_FOUND", "This workspace has no agent to check.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    let response: Response;
    try {
      response = await fetch(
        `${base.replace(/\/$/, "")}/?agentId=${encodeURIComponent(agent.id)}`,
        {
          headers: { authorization: `Bearer ${secret}`, accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        },
      );
    } catch (error) {
      throw new ApiError(
        502,
        "FUNCTION_UNREACHABLE",
        error instanceof Error
          ? `The Neon Function could not be reached: ${error.message}`
          : "The Neon Function could not be reached.",
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new ApiError(
        502,
        "FUNCTION_FAILED",
        `The Neon Function returned HTTP ${response.status}.`,
      );
    }
    const status = (await response.json()) as unknown;
    return ok({ agentId: agent.id, status });
  });
}
