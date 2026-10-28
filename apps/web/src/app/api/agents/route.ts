import { z } from "zod";
import { ok, readJson, withApi } from "@/lib/api";
import { createAgent, listAgents } from "@/lib/agents";
import { requireCsrfApi, requireUserApi } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(2).max(64),
  description: z.string().max(240).optional(),
});

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const { user } = await requireUserApi(request);
    return ok({ agents: await listAgents(user.id) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    const { user } = await requireCsrfApi(request);
    const body = await readJson(request, schema);
    const result = await createAgent({
      userId: user.id,
      name: body.name,
      description: body.description ?? null,
    });
    return ok(
      {
        agent: result.agent,
        credential: result.credential,
        onChainKeyAdded: result.onChainKeyAdded,
        warning:
          "Copy this bearer credential now. Only a hash is stored, so it cannot be shown again.",
      },
      201,
    );
  });
}
