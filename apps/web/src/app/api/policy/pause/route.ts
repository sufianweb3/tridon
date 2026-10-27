import { z } from "zod";
import { ok, readJson, withApi } from "@/lib/api";
import { setPolicyPaused } from "@/lib/policies";
import { requireCsrfApi } from "@/lib/server-auth";

const pauseSchema = z.object({ paused: z.boolean() });

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    const { user } = await requireCsrfApi(request);
    const body = await readJson(request, pauseSchema);
    const policy = await setPolicyPaused({ userId: user.id, paused: body.paused });
    return ok({ policy });
  });
}
