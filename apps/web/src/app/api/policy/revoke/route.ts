import { z } from "zod";
import { ok, readJson, withApi } from "@/lib/api";
import { revokePolicy } from "@/lib/policies";
import { requireCsrfApi } from "@/lib/server-auth";

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    const { user } = await requireCsrfApi(request);
    const body = await readJson(request, z.object({ confirmation: z.string().max(16) }));
    const policy = await revokePolicy({ userId: user.id, confirmation: body.confirmation });
    return ok({ policy });
  });
}
