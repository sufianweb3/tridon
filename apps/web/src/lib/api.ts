import { z } from "zod";
import { AgentAuthError } from "./auth";
import { appConfig } from "./config";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function ok(data: unknown, status = 200): Response {
  return Response.json(
    { ok: true, data },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

export function fail(error: ApiError): Response {
  return Response.json(
    {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    },
    {
      status: error.status,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

export async function withApi(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ApiError) return fail(error);
    if (error instanceof AgentAuthError) {
      return fail(new ApiError(error.status, error.code, error.message));
    }
    if (error instanceof z.ZodError) {
      return fail(
        new ApiError(400, "INVALID_REQUEST", "The request body is invalid.", error.issues),
      );
    }
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("[api] unhandled", message);
    return fail(
      new ApiError(500, "INTERNAL_ERROR", "An internal error occurred. Nothing was charged."),
    );
  }
}

export async function readJson<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > appConfig.limits.maxBodyBytes) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  }
  const text = await request.text();
  if (text.length > appConfig.limits.maxBodyBytes) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  }
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
  return schema.parse(parsed);
}

export function requestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") ?? "local";
}

export function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match?.[1]) {
    throw new ApiError(401, "UNAUTHENTICATED", "A bearer credential is required.");
  }
  return match[1].trim();
}

export function assertCsrf(request: Request, expected: string): void {
  const provided = request.headers.get("x-csrf-token") ?? "";
  if (!provided || provided.length !== expected.length) {
    throw new ApiError(403, "CSRF_FAILED", "Missing or invalid CSRF token.");
  }
  let mismatch = 0;
  for (let i = 0; i < provided.length; i += 1) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (mismatch !== 0) {
    throw new ApiError(403, "CSRF_FAILED", "Missing or invalid CSRF token.");
  }
}

export function pagination(url: string): { limit: number; offset: number } {
  const params = new URL(url).searchParams;
  const limit = Math.min(Math.max(Number(params.get("limit") ?? "50"), 1), 100);
  const offset = Math.max(Number(params.get("offset") ?? "0"), 0);
  return { limit, offset };
}

export function queryParam(request: Request, name: string): string | null {
  return new URL(request.url).searchParams.get(name);
}
