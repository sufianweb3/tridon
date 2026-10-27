import { ok, withApi } from "@/lib/api";
import { rotateAgentCredential } from "@/lib/agents";
import { requireCsrfApi } from "@/lib/server-auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withApi(async () => {
    const { user } = await requireCsrfApi(request);
    const { id } = await params;
    const result = await rotateAgentCredential({ userId: user.id, agentId: id });
    return ok({
      credential: result.credential,
      warning:
        "The previous credential was revoked. Copy this bearer credential now; it cannot be shown again.",
    });
  });
}
