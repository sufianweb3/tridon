import type { NextRequest } from "next/server";
import { getNeonAuth } from "@/lib/neon-auth";

type RouteContext = { params: Promise<{ path: string[] }> };

function notConfigured(): Response {
  return Response.json(
    {
      ok: false,
      error: {
        code: "NEON_AUTH_NOT_CONFIGURED",
        message: "Neon Auth is not configured on this deployment.",
      },
    },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}

async function handle(request: NextRequest, context: RouteContext): Promise<Response> {
  const auth = getNeonAuth();
  if (!auth) return notConfigured();
  const handlers = auth.handler();
  switch (request.method) {
    case "POST":
      return handlers.POST(request, context);
    case "PUT":
      return handlers.PUT(request, context);
    case "DELETE":
      return handlers.DELETE(request, context);
    case "PATCH":
      return handlers.PATCH(request, context);
    default:
      return handlers.GET(request, context);
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;
