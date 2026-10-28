import { ok, withApi } from "@/lib/api";
import { requireUserApi } from "@/lib/server-auth";
import { userOverview } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withApi(async () => {
    const { user } = await requireUserApi(request);
    return ok(await userOverview(user.id, user));
  });
}
