import { ok, withApi } from "@/lib/api";
import { revokeAgent } from "@/lib/agents";
import { requireCsrfApi } from "@/lib/server-auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withApi(async () => {
    const { user } = await requireCsrfApi(request);
    const { id } = await params;
    const result = await revokeAgent({ userId: user.id, agentId: id });
    return ok(result);
  });
}
